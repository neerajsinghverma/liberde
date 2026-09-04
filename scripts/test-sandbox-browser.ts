/**
 * Boot the real Python kernel in a real browser and make it do real work.
 *
 * Everything else about the sandbox can be reasoned about; one thing cannot.
 * The kernel runs in an iframe with `sandbox="allow-scripts"` and no
 * `allow-same-origin`, which gives it an opaque origin — and whether Pyodide
 * starts under those conditions, fetches its wasm from a CDN, and can hand
 * bytes back through postMessage is a question only a browser answers.
 *
 * So this drives headless Chromium against `kernelSrcDoc` itself, imported from
 * lib/sandbox.ts rather than copied. A copy would prove that a copy works.
 *
 *   npx tsx scripts/test-sandbox-browser.ts
 *
 * Needs playwright and a chromium build; skips cleanly (exit 0) when they are
 * absent, so it never fails a machine that has not installed them.
 */

import { kernelSrcDoc } from "../lib/sandbox";

const PY_TIMEOUT = 240_000;

interface RunOut {
  output: string;
  files: { name: string; base64: string; mime: string }[];
}

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the browser test.");
    process.exit(0);
  }

  let passed = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) {
      passed++;
      console.log(`  ok    ${name}`);
    } else {
      failures.push(`${name}${detail ? " — " + detail : ""}`);
      console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    }
  };

  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") console.log("    [page error] " + m.text().slice(0, 200));
  });

  // A host page that builds the iframe exactly the way getKernel() does: srcdoc,
  // sandbox="allow-scripts", nothing else. Any deviation here would make the test
  // answer a question nobody asked.
  const CHANNEL = "liberde-browser-test";
  const host = `<!doctype html><html><body><script>
  window.__ready = false;
  window.__result = null;
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.channel !== ${JSON.stringify(CHANNEL)}) return;
    if (e.data.ready) window.__ready = true;
    if (e.data.done) window.__result = { output: e.data.output, files: e.data.files || [] };
  });
  window.__boot = function (srcdoc) {
    var f = document.createElement("iframe");
    f.style.display = "none";
    f.setAttribute("sandbox", "allow-scripts");
    f.srcdoc = srcdoc;
    document.body.appendChild(f);
    window.__frame = f;
  };
  window.__run = function (code, files) {
    window.__result = null;
    window.__frame.contentWindow.postMessage(
      { channel: ${JSON.stringify(CHANNEL)}, run: true, code: code, files: files || [] },
      "*"
    );
  };
  <\/script></body></html>`;

  await page.setContent(host);

  console.log("\nBooting the kernel in Chromium (downloads ~10MB of Pyodide)…\n");

  const t0 = Date.now();
  await page.evaluate((doc) => (window as never as { __boot: (d: string) => void }).__boot(doc), kernelSrcDoc(CHANNEL));

  let booted = true;
  try {
    await page.waitForFunction(() => (window as never as { __ready: boolean }).__ready, null, {
      timeout: 180_000,
    });
  } catch {
    booted = false;
  }

  // THE question this file exists for.
  check(
    `Pyodide boots inside sandbox="allow-scripts" with an opaque origin`,
    booted,
    booted ? "" : "the kernel never signalled ready"
  );
  if (!booted) {
    await browser.close();
    console.log("\nNothing else can run without a kernel.");
    process.exit(1);
  }
  console.log(`        (booted in ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);

  const run = async (code: string, files: RunOut["files"] = []): Promise<RunOut> => {
    await page.evaluate(
      ([c, f]) => (window as never as { __run: (a: unknown, b: unknown) => void }).__run(c, f),
      [code, files] as [string, RunOut["files"]]
    );
    await page.waitForFunction(() => (window as never as { __result: unknown }).__result !== null, null, {
      timeout: PY_TIMEOUT,
    });
    return page.evaluate(() => (window as never as { __result: RunOut }).__result);
  };

  // 1. Python at all.
  {
    const r = await run("print('hello from wasm')");
    check("python runs and stdout comes back", r.output.includes("hello from wasm"), r.output.slice(0, 120));
  }

  // 2. A package the model will reach for, loaded from the import alone.
  {
    const r = await run("import numpy as np\nprint(np.arange(5).sum())");
    check("numpy loads from the import and computes", r.output.trim().endsWith("10"), r.output.slice(0, 120));
  }

  // 3. The contract the prompt promises: files in at /data.
  {
    const csv = "region,amount\nnorth,10\nsouth,32\neast,7\n";
    const r = await run(
      "import pandas as pd\n" +
        "df = pd.read_csv('/data/sales.csv')\n" +
        "print(int(df['amount'].sum()))",
      [{ name: "sales.csv", base64: Buffer.from(csv).toString("base64"), mime: "text/csv" }]
    );
    check("an attached CSV is readable at /data", r.output.trim().endsWith("49"), r.output.slice(0, 160));
  }

  // 4. Files out of /out.
  {
    const r = await run("open('/out/report.txt','w').write('done')");
    const f = r.files.find((x) => x.name === "report.txt");
    check(
      "a file written to /out comes back",
      !!f && Buffer.from(f!.base64, "base64").toString() === "done",
      `files: ${r.files.map((x) => x.name).join(", ") || "none"}`
    );
  }

  // 5. The bug found earlier: the default matplotlib backend silently writes
  //    nothing. This is the assertion that would have caught it in a browser.
  {
    const r = await run(
      "import matplotlib\n" +
        "print('backend', matplotlib.get_backend())\n" +
        "import matplotlib.pyplot as plt\n" +
        "plt.plot([1,3,2,4])\n" +
        "plt.title('smoke')"
    );
    const png = r.files.find((x) => x.name.endsWith(".png"));
    const bytes = png ? Buffer.from(png.base64, "base64") : Buffer.alloc(0);
    check("matplotlib uses the Agg backend", /backend\s+agg/i.test(r.output), r.output.slice(0, 120));
    check(
      "an unsaved figure is captured as a real PNG",
      bytes.length > 1000 && bytes.subarray(1, 4).toString() === "PNG",
      `${bytes.length} bytes`
    );
  }

  // 6. The kernel is a kernel: state survives between runs.
  {
    await run("carried = 41");
    const r = await run("print(carried + 1)");
    check("variables persist between blocks", r.output.trim().endsWith("42"), r.output.slice(0, 120));
  }

  // 7. A dataframe specifically — the thing a follow-up question builds on.
  {
    await run("import pandas as pd\nkept = pd.DataFrame({'a':[1,2,3]})");
    const r = await run("print(int(kept['a'].sum()))");
    check("a dataframe survives to the next block", r.output.trim().endsWith("6"), r.output.slice(0, 120));
  }

  // 8. An error must come back as text, not kill the turn.
  {
    const r = await run("1/0");
    check(
      "a python error returns as a readable message",
      /ZeroDivisionError/i.test(r.output),
      r.output.slice(0, 120)
    );
  }

  // 9. And the kernel must still be alive after one.
  {
    const r = await run("print('still here')");
    check("the kernel survives an error", r.output.includes("still here"), r.output.slice(0, 120));
  }

  // 10. Binary of a size that exercises the chunked base64 path.
  {
    const r = await run("open('/out/big.bin','wb').write(bytes(range(256))*400)");
    const f = r.files.find((x) => x.name === "big.bin");
    const size = f ? Buffer.from(f.base64, "base64").length : 0;
    check("a 100KB binary survives the round trip", size === 102400, `${size} bytes`);
  }

  // 11. /out is drained, so one run's output is not re-reported by the next.
  {
    const r = await run("print('nothing written')");
    check("/out is emptied after collection", r.files.length === 0, `${r.files.length} stray files`);
  }

  // 12. The isolation the design depends on.
  {
    const isolated = await page.evaluate(() => {
      const f = (window as never as { __frame: HTMLIFrameElement }).__frame;
      try {
        // Same-origin access must throw: the frame has an opaque origin.
        return f.contentWindow!.document === null;
      } catch {
        return true;
      }
    });
    check("the host cannot read into the sandboxed frame", isolated);
  }

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} browser tests passing`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  " + f);
    process.exit(1);
  }

}

main();
