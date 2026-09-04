// The analysis tool: lets any model run code in the user's browser sandbox and
// see the output, Claude.ai-analysis-tool style. Client-safe (no server imports).
//
// Two runtimes share one tag. JavaScript is instant and costs nothing to start;
// Python is CPython in WebAssembly with the scientific stack, and is the one
// that can read the conversation's attachments and hand real files back. Both
// run in the user's own browser — there is no server, no per-run cost, and
// nothing to configure, which is also why this works identically on a
// self-hosted install.

export const ANALYSIS_SYSTEM_PROMPT = `# Analysis tool (run code)

You can execute code to compute, analyse data, verify logic, or produce files. Emit exactly one block and then STOP your reply immediately after the closing tag:

<liberdeRun lang="python">
import pandas as pd
df = pd.read_csv("/data/sales.csv")
print(df.groupby("region")["amount"].sum())
</liberdeRun>

Or, for something small and immediate:

<liberdeRun>
console.log([1,2,3].reduce((a,b) => a+b))
</liberdeRun>

**Which runtime.** Use \`lang="python"\` whenever the task touches a file, needs a library, or should produce something to download — pandas, numpy, matplotlib, scipy, scikit-learn and openpyxl are all available, and \`import\` alone is enough to load them. Use plain JavaScript (no \`lang\`) for arithmetic, a quick transformation of data already in the conversation, or checking an algorithm; it starts instantly, where Python costs a one-time runtime download on first use.

**Files in.** Every file the user attached to this conversation is already written to \`/data/\`, under its original name. Read it directly; do not ask the user to paste the contents.

**Files out.** Anything you write to \`/out/\` is returned to the user as a download. Matplotlib figures are captured automatically — just plot, no need to save. So a chart is \`plt.plot(...)\` and a spreadsheet is \`df.to_excel("/out/summary.xlsx")\`.

**State persists.** Variables, imports and dataframes stay alive between blocks in the same conversation, so a later block can build on an earlier one rather than recomputing it.

**Limits.** No shell and no arbitrary network — this runs in the browser, so \`fetch\` is subject to CORS and most APIs will refuse. Python runs for up to two minutes per block.

The output is sent back to you automatically as an execution result, then you continue — interpret it for the user or run more code. Don't use this for code the user asked you to WRITE (use artifacts for that), and never emit anything after the closing tag.`;

/** Matches a run block with or without a language attribute. */
export const RUN_TAG = /<liberdeRun(\s[^>]*)?>([\s\S]*?)<\/liberdeRun>/g;
export const RUN_RESULT_OPEN = "<liberdeRunResult>";

export type RunLang = "js" | "python";

export interface RunBlock {
  lang: RunLang;
  code: string;
}

/**
 * Pull the runnable blocks out of a reply.
 *
 * Anything that is not recognisably Python falls back to JavaScript, which is
 * the safe direction: JS starts instantly and fails visibly, whereas guessing
 * Python would download a runtime to run something that was never Python.
 */
export function extractRunBlocks(text: string): RunBlock[] {
  const blocks: RunBlock[] = [];
  for (const m of text.matchAll(RUN_TAG)) {
    const attrs = m[1] ?? "";
    const declared = attrs.match(/lang\s*=\s*["']?([a-z0-9]+)/i)?.[1]?.toLowerCase();
    const lang: RunLang = declared === "python" || declared === "py" ? "python" : "js";
    blocks.push({ lang, code: (m[2] ?? "").trim() });
  }
  return blocks;
}

export function formatRunResult(output: string): string {
  return `${RUN_RESULT_OPEN}\n${output.slice(0, 4000)}\n</liberdeRunResult>`;
}

export function parseRunResult(content: string): string | null {
  if (!content.startsWith(RUN_RESULT_OPEN)) return null;
  return content
    .replace(RUN_RESULT_OPEN, "")
    .replace("</liberdeRunResult>", "")
    .trim();
}
