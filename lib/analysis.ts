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

**There is no function to call for this.** Do not invoke a tool named \`liberdeRun\`, \`run_code\`, \`python\` or anything similar — no such function exists, and calling one wastes a turn. Writing the block above IS how you run code.

The output is sent back to you automatically as an execution result, then you continue — interpret it for the user or run more code. Don't use this for code the user asked you to WRITE (use artifacts for that), and never emit anything after the closing tag.`;

/**
 * Names models invent when they try to *call* the analysis tool.
 *
 * There is no such function: the analysis tool is a tag written into the reply.
 * Tool-capable models see it described alongside real tools and reach for a
 * function anyway. The server answers with a correction and they get it right
 * on the next turn, so the run still happens — but the phantom call and its
 * correction were both rendered as ordinary tool chips, leaving two pieces of
 * junk in the transcript for something that was never a real tool use.
 *
 * Shared so the server's guard and the client's renderer cannot disagree about
 * which names are phantoms.
 */
export const PHANTOM_RUN_TOOL =
  /^(liberde_?run|run_?(js|javascript|code|python)|code_?(execution|interpreter)|execute_?(code|javascript|python))$/i;

export function isPhantomRunTool(name: string | undefined | null): boolean {
  return !!name && PHANTOM_RUN_TOOL.test(name);
}

/**
 * Maths delimiters.
 *
 * The renderer reads dollar delimiters. Models left to themselves reach for
 * LaTeX's own \\[…\\], and markdown strips the backslash on the way, so the
 * formula arrives as a bare bracketed line and is displayed as source. The
 * normaliser in lib/math.ts repairs that after the fact; this stops it
 * happening in the first place, which is cheaper and more reliable than
 * repairing every variant a model can invent.
 */
export const MATH_PROMPT = [
  "# Maths",
  "Wrap mathematics in DOUBLE dollar delimiters: $$x^2$$. Do NOT use single" +
    " dollars, \\[ … \\], \\( … \\), or bare square brackets — none of those render" +
    " as maths.",
  "A single dollar is a currency sign here, so write money as plain text —" +
    " $500,000 — and never as a formula. Plain prose and simple numbers need no" +
    " delimiters at all.",
].join("\n");

/** Matches a run block with or without a language attribute. */
export const RUN_TAG = /<liberdeRun(\s[^>]*)?>([\s\S]*?)<\/liberdeRun>/g;
export const RUN_RESULT_OPEN = "<liberdeRunResult>";

export type RunLang = "js" | "python";

export interface RunBlock {
  lang: RunLang;
  code: string;
}

/**
 * Read the language off a run tag's attributes.
 *
 * Anything not recognisably Python is JavaScript, which is the safe direction:
 * JS starts instantly and fails visibly, whereas guessing Python downloads a
 * runtime to run something that never was.
 */
export function langOf(attrs: string): RunLang {
  const declared = attrs.match(/lang\s*=\s*["']?([a-z0-9]+)/i)?.[1]?.toLowerCase();
  return declared === "python" || declared === "py" ? "python" : "js";
}

export function extractRunBlocks(text: string): RunBlock[] {
  const blocks: RunBlock[] = [];
  for (const m of text.matchAll(RUN_TAG)) {
    blocks.push({ lang: langOf(m[1] ?? ""), code: (m[2] ?? "").trim() });
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

/** One piece of an assistant reply: prose, or a block of code it ran. */
export type ReplyPart =
  | { kind: "text"; text: string }
  | { kind: "run"; lang: RunLang; code: string; complete: boolean };

/**
 * Split a reply into prose and run blocks.
 *
 * The raw tag must never reach the screen. It used to: nothing stripped
 * <liberdeRun> from the rendered bubble, so a Python block was displayed as its
 * own source — opening tag, imports and all — while also executing. And the one
 * place that did strip it (the PDF/HTML export) matched `<liberdeRun>` with no
 * attributes, so `lang="python"` sailed straight through that too.
 *
 * An unterminated block is reported with complete: false rather than held back,
 * so the interface can say "writing code" while it streams instead of leaking
 * half a tag.
 */
export function splitReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  const re = new RegExp(RUN_TAG.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    parts.push({ kind: "run", lang: langOf(m[1] ?? ""), code: (m[2] ?? "").trim(), complete: true });
    last = re.lastIndex;
  }

  let rest = text.slice(last);
  // A block still arriving: everything from the opening tag onwards is code.
  const open = rest.match(/<liberdeRun(\s[^>]*)?>/);
  if (open && open.index !== undefined) {
    const before = rest.slice(0, open.index);
    if (before) parts.push({ kind: "text", text: before });
    parts.push({
      kind: "run",
      lang: langOf(open[1] ?? ""),
      code: rest.slice(open.index + open[0].length),
      complete: false,
    });
    rest = "";
  }
  if (rest) parts.push({ kind: "text", text: rest });

  return parts;
}

/** Strip run blocks entirely — for exports, speech, and search indexing. */
export function stripRunBlocks(text: string, replacement = ""): string {
  return text.replace(/<liberdeRun(\s[^>]*)?>[\s\S]*?(<\/liberdeRun>|$)/g, replacement);
}
