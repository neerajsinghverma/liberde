// The analysis tool: lets any model run JavaScript in the user's browser sandbox
// and see the output, Claude.ai-analysis-tool style. Client-safe (no server imports).

export const ANALYSIS_SYSTEM_PROMPT = `# Analysis tool (run JavaScript)

You can execute JavaScript to compute, analyze data, verify logic, or test code. Emit exactly one block and then STOP your reply immediately after the closing tag:

<liberdeRun>
// modern async JS; use console.log(...) for everything you want to see
</liberdeRun>

The code runs in the user's browser sandbox (no filesystem; network via fetch subject to CORS; 10s limit). The console output is sent back to you automatically as an execution result, then you continue — interpret the output for the user or run more code. Use this for arithmetic you might get wrong, data transformations, quick algorithm checks. Don't use it for code the user asked you to WRITE (use artifacts for that), and never emit anything after the closing tag.`;

export const RUN_TAG = /<liberdeRun>([\s\S]*?)<\/liberdeRun>/g;
export const RUN_RESULT_OPEN = "<liberdeRunResult>";

export function extractRunBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const m of text.matchAll(RUN_TAG)) blocks.push(m[1].trim());
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
