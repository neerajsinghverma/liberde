// Lightweight retrieval over project knowledge files. Instead of dumping every
// file into context (which blows the window as projects grow), chunk the files
// and select the chunks most relevant to the current query. Lexical scoring —
// no embedding service required — and easily upgraded to vector search later.

export interface KnowledgeFile {
  name: string;
  content: string;
}

const CHUNK_SIZE = 1500;
/** Below this total, just include everything — retrieval isn't worth it. */
const INCLUDE_ALL_UNDER = 12_000;
const DEFAULT_BUDGET = 12_000;

function chunkFile(content: string): string[] {
  const paras = content.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > CHUNK_SIZE && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [content];
}

export function retrieveRelevant(
  files: KnowledgeFile[],
  query: string,
  budget = DEFAULT_BUDGET
): { name: string; text: string }[] {
  const total = files.reduce((n, f) => n + f.content.length, 0);
  const chunks = files.flatMap((f) =>
    chunkFile(f.content).map((text) => ({ name: f.name, text }))
  );
  if (total <= INCLUDE_ALL_UNDER) return chunks;

  const terms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 40);
  if (terms.length === 0) {
    // No usable query — take the leading chunks up to budget.
    const out: { name: string; text: string }[] = [];
    let used = 0;
    for (const c of chunks) {
      if (used + c.text.length > budget) break;
      out.push(c);
      used += c.text.length;
    }
    return out;
  }

  const scored = chunks
    .map((c) => {
      const lc = c.text.toLowerCase();
      let score = 0;
      for (const t of terms) {
        let idx = lc.indexOf(t);
        while (idx !== -1) {
          score++;
          idx = lc.indexOf(t, idx + t.length);
        }
      }
      // Length-normalize so long chunks don't dominate by sheer size.
      return { ...c, score: score / Math.sqrt(c.text.length + 1) };
    })
    .sort((a, b) => b.score - a.score);

  const out: { name: string; text: string }[] = [];
  let used = 0;
  for (const c of scored) {
    if (c.score <= 0) continue;
    if (used + c.text.length > budget) continue;
    out.push({ name: c.name, text: c.text });
    used += c.text.length;
  }
  // Fall back to the first few chunks if nothing scored (query unrelated to docs).
  return out.length ? out : scored.slice(0, 3).map((c) => ({ name: c.name, text: c.text }));
}
