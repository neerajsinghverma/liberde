// Retrieval over project knowledge files. Instead of dumping every file into
// context — which blows the window as a project grows — the files are chunked
// and only the chunks relevant to the current query are included.
//
// Two strategies, in order of preference:
//
//   retrieveSemantic  cosine similarity over stored embeddings. Finds a
//                     paragraph that answers the question in different words,
//                     which is the whole point. Needs an embeddings endpoint.
//   retrieveRelevant  term-frequency scoring. No service required, and the
//                     fallback whenever the semantic path is unavailable.
//
// The fallback is not a formality. If it were removed, an expired embeddings
// key would turn every project chat into one with no knowledge at all, and
// nothing in the interface would say why.

import { cosine, embed, embeddingConfig } from "./embeddings";
import { indexedFileIds, listProjectChunks, replaceFileChunks } from "./db";

/**
 * Relevance is judged relative to the best match, not against a fixed score.
 *
 * Embedding models do not share a scale. The same pair of related sentences
 * might score 0.34 on one model and 0.81 on another, so any absolute cut-off
 * is tuned for exactly one model and quietly wrong for the local one someone
 * plugs in. Keeping everything within a fraction of the top hit adapts to
 * whatever scale the configured model happens to use.
 *
 * The absolute floor only exists to reject the degenerate case where nothing
 * in the project is related to the question at all — without it, the best of
 * a set of irrelevant chunks would always look relevant.
 */
const RELATIVE_FLOOR = 0.6;
const ABSOLUTE_FLOOR = 0.12;

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

/**
 * Semantic retrieval, with the lexical scorer above as the fallback.
 *
 * Two conditions have to hold for this to run: an embeddings endpoint is
 * configured, and the project has already been indexed against the same model.
 * Either missing means the caller silently gets the lexical result, which is
 * what shipped before. A knowledge base that degrades is tolerable; one that
 * errors because a key expired is not.
 *
 * Chunks are ranked by cosine similarity and taken until the budget is spent,
 * then re-sorted into document order — a model reads a document far better
 * when its paragraphs arrive in the order they were written, even though the
 * selection was made by relevance.
 */
export async function retrieveSemantic(
  projectId: string,
  query: string,
  budget = DEFAULT_BUDGET,
  userId?: string
): Promise<{ name: string; text: string }[] | null> {
  const q = query.trim();
  if (!q) return null;

  const cfg = await embeddingConfig(userId);
  if (!cfg) return null;

  const stored = await listProjectChunks(projectId, cfg.model);
  if (stored.length === 0) return null;

  const queryVec = await embed([q], cfg);
  if (!queryVec || queryVec.length === 0) return null;

  const scored = stored
    .map((c) => ({ chunk: c, score: cosine(queryVec[0], c.vector) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.score ?? 0;
  if (best < ABSOLUTE_FLOOR) return null;
  const cutoff = best * RELATIVE_FLOOR;

  const picked: typeof scored = [];
  let used = 0;
  for (const s of scored) {
    // A weak match is worse than no match: it spends budget a genuinely
    // relevant chunk further down the list would have used.
    if (s.score < cutoff) break;
    if (used + s.chunk.text.length > budget) continue;
    picked.push(s);
    used += s.chunk.text.length;
  }
  if (picked.length === 0) return null;

  picked.sort(
    (a, b) =>
      a.chunk.file_name.localeCompare(b.chunk.file_name) ||
      a.chunk.chunk_index - b.chunk.chunk_index
  );
  return picked.map((s) => ({ name: s.chunk.file_name, text: s.chunk.text }));
}

/**
 * Bring a project's vectors up to date, embedding only the files that do not
 * already have them for the current model. Returns how many files were indexed.
 * Never throws — indexing is best-effort and the lexical path always remains.
 */
export async function indexProject(
  projectId: string,
  files: { id: string; name: string; content: string }[],
  userId?: string
): Promise<number> {
  try {
    const cfg = await embeddingConfig(userId);
    if (!cfg) return 0;
    const already = await indexedFileIds(projectId, cfg.model);
    let done = 0;
    for (const f of files) {
      if (already.has(f.id)) continue;
      const texts = chunkFile(f.content);
      if (texts.length === 0) continue;
      const vectors = await embed(texts, cfg);
      if (!vectors) return done;
      await replaceFileChunks(
        projectId,
        f.id,
        f.name,
        texts.map((text, i) => ({ text, vector: vectors[i] })),
        cfg.model
      );
      done++;
    }
    return done;
  } catch (e) {
    console.error("[liberde] project indexing failed:", String(e).slice(0, 200));
    return 0;
  }
}
