/**
 * Normalise the maths delimiters models actually emit.
 *
 * remark-math understands \$…\$ and \$\$…\$\$. Models routinely write LaTeX's own
 * \\[…\\] and \\(…\\) instead — and markdown eats the backslash on the way,
 * so what lands in the renderer is a bare bracketed line:
 *
 *     [ \\frac{\$500{,}000}{0.03} = \$16{,}666{,}667 ]
 *
 * which is exactly what appeared on screen as literal source. This converts the
 * forms they use into the ones the renderer reads.
 *
 * Deliberately conservative about bare brackets: a line is only treated as maths
 * when it contains a TeX command, because `[ a ]` is also ordinary prose and
 * turning that into a formula would be a worse failure than leaving it alone.
 */

/** A backslash command like \\frac, \\times, \\boxed — the tell for real TeX. */
const TEX_COMMAND = /\\[a-zA-Z]{2,}/;

export function normaliseMath(text: string): string {
  let out = text;

  // LaTeX display and inline delimiters → dollar forms.
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => "$$" + body.trim() + "$$");
  // Both forms target the double delimiter. Single-dollar maths is disabled in
  // the renderer, because a lone dollar in this app is nearly always currency.
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => "$$" + body.trim() + "$$");

  // A whole line that is just [ …TeX… ] — the backslash-stripped display form.
  out = out
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*\[\s*([\s\S]*?)\s*\]\s*$/);
      if (!m) return line;
      const body = m[1];
      if (!TEX_COMMAND.test(body) && !/[_^]|\{.*\}/.test(body)) return line;
      return "$$" + body + "$$";
    })
    .join("\n");

  return out;
}
