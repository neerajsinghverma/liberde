"use client";

/** Run JavaScript in a hidden sandboxed iframe; resolve with captured console output. */
export function runJs(code: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    const channel = "liberde-run-" + Math.random().toString(36).slice(2);
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

    const embedded = JSON.stringify(code).replace(/</g, "\\u003c");
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
      await new AsyncFunction(${embedded})();
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
