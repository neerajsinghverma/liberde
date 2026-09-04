"use client";

/**
 * The analysis sandbox: code the model writes, run in the user's own browser.
 *
 * Everything happens inside a hidden iframe with `sandbox="allow-scripts"` and
 * no `allow-same-origin`, so the frame gets an opaque origin and cannot read
 * cookies, localStorage or anything else belonging to the app. The only channel
 * back is postMessage, and only the shapes below are honoured.
 *
 * Two runtimes:
 *
 *   JavaScript  instant, no download, good for arithmetic and quick checks.
 *   Python      CPython compiled to WebAssembly, with numpy, pandas,
 *               matplotlib and friends. Costs a one-time ~10MB download.
 *
 * Python is where the useful work happens, because it can be handed the
 * conversation's attachments as real files and can hand real files back. That
 * pairing — read a spreadsheet, return a chart — is the thing a browser-only
 * runtime was previously incapable of, and none of it needs a server.
 */

/** A file passed into the sandbox, or produced by it. */
export interface SandboxFile {
  name: string;
  /** Base64, so binary survives the postMessage round trip unharmed. */
  base64: string;
  mime: string;
}

export interface RunResult {
  /** Captured stdout, stderr and console output. */
  output: string;
  /** Anything the code wrote to /out, plus any matplotlib figures. */
  files: SandboxFile[];
}

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";

/** Long enough for a real pandas job; short enough that a runaway loop ends. */
export const DEFAULT_JS_TIMEOUT = 15_000;
export const DEFAULT_PY_TIMEOUT = 120_000;

const newChannel = () => "liberde-run-" + Math.random().toString(36).slice(2);

/** Escape source for embedding inside an inline script tag. */
const embed = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");

/* ------------------------------------------------------------------ JS ---- */

/** Run JavaScript in a throwaway frame and resolve with its console output. */
export function runJs(code: string, timeoutMs = DEFAULT_JS_TIMEOUT): Promise<string> {
  return new Promise((resolve) => {
    const channel = newChannel();
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.setAttribute("sandbox", "allow-scripts");

    let settled = false;
    const finish = (output: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve(output);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data && e.data.channel === channel) finish(String(e.data.output ?? ""));
    };
    window.addEventListener("message", onMessage);

    iframe.srcdoc = `<script>
(function(){
  var logs = [];
  function fmt(a){ try { return typeof a === "object" && a !== null ? JSON.stringify(a, null, 1) : String(a); } catch(e){ return String(a); } }
  ["log","info","warn","error"].forEach(function(level){
    console[level] = function(){ logs.push(Array.prototype.map.call(arguments, fmt).join(" ")); };
  });
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  (async function(){
    try {
      await new AsyncFunction(${embed(code)})();
    } catch (e) {
      logs.push("Error: " + (e && e.message ? e.message : String(e)));
    }
    parent.postMessage({ channel: ${JSON.stringify(channel)}, output: logs.join("\\n") || "(no console output — use console.log)" }, "*");
  })();
})();
<\/script>`;

    document.body.appendChild(iframe);
    setTimeout(() => finish(`Error: execution timed out after ${timeoutMs / 1000}s`), timeoutMs);
  });
}

/* -------------------------------------------------------------- Python ---- */

interface Kernel {
  frame: HTMLIFrameElement;
  ready: Promise<void>;
  channel: string;
}

/**
 * One kernel per conversation, kept alive between runs.
 *
 * Reuse is what makes a second cell feel instant instead of costing another
 * interpreter boot, and it is also what lets variables survive from one block
 * to the next — without it every run starts from nothing and the model has to
 * re-derive its own intermediate state, which is both slower and wrong more
 * often.
 */
const kernels = new Map<string, Kernel>();

/** Drop a conversation's kernel; the next run boots a fresh one. */
export function resetPythonKernel(key = "default"): void {
  const k = kernels.get(key);
  if (k) {
    k.frame.remove();
    kernels.delete(key);
  }
}

/**
 * The kernel page, as a string.
 *
 * Exported so a headless browser can boot the real thing rather than a copy
 * of it — the one question this module cannot answer by reasoning is whether
 * Pyodide starts under `sandbox="allow-scripts"` with an opaque origin, and a
 * test against a duplicate would not answer it either.
 */
export function kernelSrcDoc(channel: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="${PYODIDE_CDN}pyodide.js"><\/script>
<script>
(function(){
  var CH = ${JSON.stringify(channel)};
  var pyodide = null;
  var booting = null;
  var out = [];

  function post(msg){ try { parent.postMessage(Object.assign({ channel: CH }, msg), "*"); } catch(e){} }

  function boot(){
    if (booting) return booting;
    booting = (async function(){
      pyodide = await loadPyodide({
        indexURL: ${JSON.stringify(PYODIDE_CDN)},
        stdout: function(s){ out.push(s); },
        stderr: function(s){ out.push(s); }
      });
      // Directories the contract depends on: /data is what the user gave us,
      // /out is what we give back.
      pyodide.FS.mkdirTree("/data");
      pyodide.FS.mkdirTree("/out");
      await pyodide.loadPackage("micropip");
      // Pyodide defaults matplotlib to a canvas backend that draws into a DOM
      // element, under which savefig writes nothing at all and raises nothing
      // either — a model writing ordinary matplotlib would get no chart and no
      // error. Agg renders to a buffer, which is what the figure capture needs.
      pyodide.runPython("import os; os.environ['MPLBACKEND'] = 'AGG'");
      post({ ready: true });
    })();
    return booting;
  }

  async function writeFiles(files){
    for (var i = 0; i < (files || []).length; i++) {
      var f = files[i];
      var bin = atob(f.base64);
      var bytes = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      pyodide.FS.writeFile("/data/" + f.name, bytes);
    }
  }

  function collectOutputs(){
    var files = [];
    var names = [];
    try { names = pyodide.FS.readdir("/out"); } catch(e){ return files; }
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n === "." || n === "..") continue;
      try {
        var data = pyodide.FS.readFile("/out/" + n);
        var s = "";
        // Chunked so a large file does not blow the argument limit.
        for (var k = 0; k < data.length; k += 8192) {
          s += String.fromCharCode.apply(null, data.subarray(k, k + 8192));
        }
        files.push({ name: n, base64: btoa(s), mime: mimeOf(n) });
        pyodide.FS.unlink("/out/" + n);
      } catch (e) { /* skip an unreadable output */ }
    }
    return files;
  }

  function mimeOf(name){
    var ext = (name.split(".").pop() || "").toLowerCase();
    var map = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml",
      csv: "text/csv", json: "application/json", txt: "text/plain", md: "text/markdown",
      html: "text/html", pdf: "application/pdf",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    return map[ext] || "application/octet-stream";
  }

  window.addEventListener("message", async function(e){
    var d = e.data;
    if (!d || d.channel !== CH || !d.run) return;
    out = [];
    try {
      await boot();
      await writeFiles(d.files);
      // Imports are discovered from the source, so a model does not have to
      // remember to install anything before using pandas.
      await pyodide.loadPackagesFromImports(d.code);
      // Any figure still open at the end is written out, so a model that calls
      // plt.show() the way it would in a notebook still produces an image.
      var wrapped = d.code + "\\n\\ntry:\\n    import matplotlib.pyplot as _plt\\n    for _i, _n in enumerate(_plt.get_fignums()):\\n        _plt.figure(_n).savefig('/out/figure-%d.png' % (_i + 1), bbox_inches='tight', dpi=120)\\n    _plt.close('all')\\nexcept Exception:\\n    pass\\n";
      var result = await pyodide.runPythonAsync(wrapped);
      if (result !== undefined && result !== null) out.push(String(result));
      post({ done: true, output: out.join("\\n"), files: collectOutputs() });
    } catch (err) {
      out.push(String((err && err.message) || err));
      post({ done: true, output: out.join("\\n"), files: collectOutputs() });
    }
  });

  boot();
})();
<\/script></body></html>`;
}

function getKernel(key: string): Kernel {
  const existing = kernels.get(key);
  if (existing) return existing;

  const channel = newChannel();
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.srcdoc = kernelSrcDoc(channel);

  const ready = new Promise<void>((resolve, reject) => {
    const onReady = (e: MessageEvent) => {
      if (e.data && e.data.channel === channel && e.data.ready) {
        window.removeEventListener("message", onReady);
        resolve();
      }
    };
    window.addEventListener("message", onReady);
    // A boot that never finishes is almost always a blocked CDN. Failing loudly
    // beats a run that hangs with no explanation.
    setTimeout(() => {
      window.removeEventListener("message", onReady);
      reject(new Error("Python runtime did not start (the CDN may be blocked)"));
    }, 90_000);
  });

  document.body.appendChild(frame);
  const kernel = { frame, ready, channel };
  kernels.set(key, kernel);
  return kernel;
}

/**
 * Run Python in the conversation's kernel.
 *
 * `files` are written to /data before the code runs; anything the code leaves
 * in /out comes back, along with any matplotlib figure still open. Never
 * rejects — a failed run returns its error as output, because the result is fed
 * straight back to the model and an exception it can read is more useful than
 * one that breaks the turn.
 */
export function runPython(
  code: string,
  opts: { files?: SandboxFile[]; timeoutMs?: number; kernelKey?: string } = {}
): Promise<RunResult> {
  const { files = [], timeoutMs = DEFAULT_PY_TIMEOUT, kernelKey = "default" } = opts;

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(r);
    };

    let kernel: Kernel;
    try {
      kernel = getKernel(kernelKey);
    } catch (e) {
      resolve({ output: "Error: " + String((e as Error).message || e), files: [] });
      return;
    }

    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.channel !== kernel.channel || !d.done) return;
      finish({ output: String(d.output ?? ""), files: Array.isArray(d.files) ? d.files : [] });
    };
    window.addEventListener("message", onMessage);

    const timer = setTimeout(() => {
      // A timed-out kernel may be mid-computation and cannot be interrupted, so
      // it is discarded rather than reused with unknown state.
      resetPythonKernel(kernelKey);
      finish({
        output: `Error: execution timed out after ${Math.round(timeoutMs / 1000)}s`,
        files: [],
      });
    }, timeoutMs);

    kernel.ready
      .then(() => {
        kernel.frame.contentWindow?.postMessage(
          { channel: kernel.channel, run: true, code, files },
          "*"
        );
      })
      .catch((err) => {
        clearTimeout(timer);
        resetPythonKernel(kernelKey);
        finish({ output: "Error: " + String(err.message || err), files: [] });
      });
  });
}
