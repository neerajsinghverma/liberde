# Changelog

Everything that has shipped in Liberde, newest first.

Liberde ships as **two editions of the same app** — the hosted/cloud build
([liberde](https://github.com/neerajsinghverma/liberde)) and the self-host build
([liberde-self-host](https://github.com/neerajsinghverma/liberde-self-host)). Every change below
landed in both on the same day; only storage and runtime differ.

A browsable version of this page lives at **[liberde.ai/changelog.html](https://liberde.ai/changelog.html)**.

---

## 2026-09-04 (later) — Everything reachable, and a check that keeps it that way

### Added

- **Agents** — a named configuration you start a chat as: model, standing instructions, a
  project's knowledge, the skills it always loads, and the tools it should reach for.
  **Settings → Agents** to build one; chips under the greeting on a new chat to start one.
- **Settings → Workspaces** and **Settings → Audit log** — both features existed and had no
  interface at all. The README described them as though they did.
- **`npm run verify`** — a reachability, parity, documentation-truth and wiring audit (359
  checks), 71 logic tests, 14 browser tests that boot the real Python kernel in headless
  Chromium, a 25-step end-to-end walk through a freshly signed-up account, and a live smoke
  test asserting every private route refuses an anonymous caller (36 checks).

### Changed

- **Semantic search no longer needs a second API key.** OpenRouter serves
  `/api/v1/embeddings` with the key you already have — the previous requirement rested on a
  wrong belief, written into a code comment and repeated in the docs. It is one switch now,
  with a separate endpoint still available for a local Ollama or LM Studio.
- **Self-host applies agents.** The API and the schema were there; the chat route never read
  them, so picking an agent did nothing on a self-hosted install.

### Fixed

- **A model could announce a code run and then not make one.** After an error came back it
  would reply "I need to recompute the dataset, then insert it into the artifact" — and stop,
  leaving the turn finished and the user waiting for work that never started. The artifacts
  prompt has forbidden exactly this shape for a while; the analysis prompt now does too.
- **The artifact panel could stay stuck on a half-written preview.** Swapping it for the saved
  record happened only in the stream's completion callback, so a reply that finished while
  the tab was backgrounded left the preview frozen. The artifacts themselves were never at
  risk — they are written server-side when the message is saved — but the panel had no way to
  find out. It now settles on reload and on returning to the tab.
- **"Ran Python" no longer claims a run that did not happen.** The label was asserted from the
  presence of a closing tag, which only means the model finished writing the code. It now
  reports what it knows: writing, ran, or written but not run.
- **A code run could stall the turn with no output and no continuation.** The analysis loop
  — run the code, hand the output back, let the model carry on — lived only inside the
  stream's completion callback. A reply can finish without this tab ever watching that
  stream: switch tabs and the connection is dropped while the server keeps writing. The
  client then picks the answer up by re-reading the conversation, and the code was never
  executed at all. The turn ended at the block, labelled as though it had run.
  The loop is now independent of how the turn arrived — it resumes on returning to the tab
  and on opening a conversation — and it will not run the same block twice. Exhausting the
  four-run limit now says so instead of stopping in silence, which read as the app losing
  the thread.
- **An artifact still being written could be dumped into the chat as source.** The
  server-side mirror of an in-flight reply — the thing that lets you reload or switch tabs
  without losing an answer — was rendered through raw Markdown instead of the segmented
  renderer, so it carried none of the tag handling a live stream gets. An artifact caught
  mid-write printed its `<liberdeArtifact>` tag and its entire HTML body as message text.
  It now goes through the same renderer as everything else: the artifact shows as a card and
  its content goes to the artifact panel, where it belongs.
- **Maths renders as maths.** Formulas arrived as raw LaTeX — `[ \frac{...} ]` printed as
  source — because nothing rendered them. KaTeX now does, models are told which delimiters
  the renderer reads, and a normaliser repairs the variants they use anyway (`\[ … \]`,
  `\( … \)`, and the bare bracketed line markdown leaves behind after eating the
  backslash).
  **Single-dollar maths is deliberately off.** With it on, "$16.67 million … to safely draw
  $500,000" had everything between the two dollars swallowed as a formula. A lone dollar here
  is currency far more often than a delimiter, so maths needs `$…$` and money is left alone.
- **The Regenerate list no longer offers `auto`** — a routing instruction with no endpoint,
  which could only fail if picked.
- **A phantom tool call left two junk chips in every analysis run.** Tool-capable models try
  to *call* the analysis tool, which is a tag rather than a function. The server already
  corrected them — that is why runs succeeded — but the bogus call and its correction were
  both drawn as ordinary tool chips. They are recognised and hidden now, and the prompt says
  outright that no such function exists, which should save the wasted round trip as well.
- **You could not see what the code printed.** The output block existed but was collapsed and
  labelled "Execution result", so a run that worked showed nothing but two folded strips. It
  is now labelled **Output**, open by default, and scrolls internally when long — and its
  toggle uses the icon set rather than the ▸ ▴ ▾ characters left over from before the icon
  work.
- **"TypeError: Load failed" after switching tabs away and back.** Backgrounding a tab kills
  in-flight fetches; WebKit reports that as `TypeError: Load failed` and Chrome as `Failed to
  fetch`, and neither is an `AbortError` — so only an explicit cancel was being filtered and a
  dropped connection was painted as a failed answer. It is now recognised as the stream going
  away rather than a fault, and returning to the tab re-reads the conversation so the reply
  the server kept writing is there in full instead of truncated at whatever arrived first.
- **The code the analysis tool ran was not syntax-highlighted.** The fold used a bare `<pre>`;
  it now renders through the same markdown path as every other code block, so it gets
  highlighting and a Copy control.
- **A Python analysis block was printed as its own source.** Nothing stripped `<liberdeRun>`
  from the rendered reply, so the opening tag, the imports and the whole script appeared as
  chat text — while also executing correctly, which made it look like a formatting failure
  rather than the missing renderer it was. The code now appears as a foldable *Ran Python*
  block, collapsed by default, and a block still streaming reads *Writing Python…* instead
  of leaking half a tag.
- **The same tag survived into PDF and HTML exports.** The one place that did strip it
  matched `<liberdeRun>` with no attributes, so every `lang="python"` block went through
  untouched. Display, export and speech now share one implementation.
- **A long council verdict squashed the answers below it.** The verdict sits above the
  columns and had no height limit, so a careful comparison of three detailed answers left
  the columns as a 40px strip. It is now collapsible — click the header — and capped at 45%
  of the viewport even when open, with a floor under the columns. Collapsing it returns
  about 290px to the answers.
- **The Regenerate model menu ran off the top of the window.** It was hardcoded to open
  upward, so a reply near the top of the viewport had its model list clipped by the top of
  the screen with no way to reach it. It now opens downward by default and flips up only
  when the space below genuinely cannot hold a usable menu, with its height capped to
  whatever room there is.
- **Second opinion defaulted to old models, and offered one that cannot be called.** The
  catalog arrives sorted by *name*, and the picker took the first match per family — so
  "Claude 3 Haiku" beat every newer Claude on alphabetical order alone, and the Auto router
  appeared as a selectable model despite being a routing instruction with no endpoint. The
  default set is now the newest model per lab *under a price ceiling* — a comparison runs
  three models on one question, so reaching for the top of the catalog by default spends
  three flagship turns on a second opinion nobody asked to be expensive. The ceiling is the
  catalog's own 95th percentile rather than a hardcoded figure, which currently lands on
  Opus-tier and excludes the $50-per-million flagships. Batch variants are excluded too
  (cheaper because they are *not* answered promptly), and the set spans three labs rather
  than three families from two. Anything dearer stays one click away in the picker.
- **The council verdict now leads the panel** instead of sitting under three columns of the
  material it summarises.
- **Second opinion showed no answers on a phone.** The comparison columns carried `flex-1
  basis-0`, and the mobile layout switches the container to `flex-col` — so the basis applied
  to *height*, with no definite parent height to grow into, and every answer collapsed to a
  bare border. The verdict then appeared directly under the controls, which read as the
  council running before the models had answered. Columns now stack at their natural height
  and scroll.
- **The verdict could invent a count.** The synthesiser is handed only the answers that
  arrived, and was never told how many that was — so with a failed model it could still write
  "all three agree". It is now given the number explicitly, and the panel says *Only 2 of 3
  models answered* when a comparison comes up short.
- **Choosing an agent from the new-chat chips did nothing.** The click set the state and the
  conversation was still created without it, because `send` was a `useCallback` that never
  listed the agent in its dependencies and so captured `null` from mount. The API path was
  correct throughout — only a live model could show the difference, and it did.
- **The Settings close button sat on top of the text.** Long tab descriptions wrapped
  underneath it, and the footer offered Save on tabs that save through their own controls.
- **The welcome tour came back on every page load.** It shows while no API key is set —
  which stays true — and dismissal was never remembered, so Skip meant "skip until you
  click anything". It also ignored Escape and backdrop clicks, unlike every other overlay.
- **`/help` 404'd on a reload or a shared link.** The shell pushed the URL and parsed it
  back, but no page file existed, so it only worked while you stayed inside the app.
- **Creating an agent failed on self-host** with `9 values for 12 columns` — the insert was
  ported to the SQLite build with three new columns and no matching placeholders.
- **Comparing models on a thread containing an image** offered models that cannot read one,
  then printed the provider's raw JSON when they 404'd. Text-only models are now
  unselectable with the reason shown, and every upstream error is reported as a sentence.
- **The image model had to be typed by hand**, so a typo became a runtime failure. It is now
  a list of the models that can actually emit an image.

---

## 2026-09-04 — Code that runs, and a home for everything you build

### Added

- **A code interpreter that runs in your browser.** The model writes Python and runs it — real
  CPython in WebAssembly with pandas, numpy, matplotlib, scipy, scikit-learn and openpyxl, loaded
  on demand from the code's own imports. Conversation attachments are mounted as real files at
  `/data`; anything written to `/out` comes back as a download, and matplotlib figures are
  captured automatically. The kernel is kept alive per conversation, so variables and dataframes
  survive between blocks.
  It runs in a sandboxed frame with an opaque origin on the user's own machine: no server, no
  per-run cost, nothing to configure, and identical behaviour on a self-hosted install.
- **An artifacts gallery** (`/artifacts`) — every artifact you have built and everything shared
  with you, in one grid with previews, All / Yours / Shared filters, and full-text search across
  contents. Opening one of yours jumps to its conversation; opening a shared one clones an
  editable copy. "Shared with you" is now a tab here rather than a separate view.
- **A council verdict on Second opinion** — after the columns land, a *separate* model writes what
  the answers agree on, every place they genuinely contradict each other, and one consolidated
  answer you can keep in a click. Real conflicts are named rather than smoothed over.
- **Semantic retrieval over project knowledge** — project files are embedded and searched by
  meaning via any OpenAI-compatible `/embeddings` endpoint (OpenAI, a local Ollama, LM Studio),
  configured in Settings → General. Relevance is judged *relative to the best match* rather than
  against a fixed score, because embedding models do not share a scale. With no endpoint
  configured it falls back to the lexical scorer rather than failing.
- **Install a skill from a URL** — paste a link to any `SKILL.md`; Liberde fetches it for review
  (what it says, which tools it declares, lines worth a second look, whether the name clashes)
  and installs only on a second, explicit step.
- **Design-system conformance** — an artifact built under a locked design system is checked
  against it, and the panel reports colours outside the palette, fonts the system never named,
  and emoji used where an icon belongs. Advisory, never blocking.

### Changed

- **Design systems are prescriptive**, and now carry icon rules alongside palette, typography,
  spacing, components and voice.
- **Real icons everywhere** — emoji used as interface icons replaced with one drawn set. Emoji
  render differently per platform, ignore the theme, and cannot be sized or coloured with the
  rest of the interface.
- **Function duration raised from the 300s default to the 800s ceiling** (Fluid Compute). A run
  that would still exceed it checkpoints and resumes rather than being hard-killed.

### Fixed

- **Gallery card previews** were slicing the first few hundred characters of source — a doctype
  and a stylesheet for HTML, an import block for React — so every card showed the same wall of
  custom properties. Previews now extract headings and prose, plus the artifact's own palette.
- **Auto routing asked how long a message was before asking what it contained**, so a short
  message carrying a stack trace was classified as a trivial follow-up.

---

## 2026-09-03 — Governance, cost, and the way it feels to use

### Added

- **Tamper-evident audit log** — every entry is hashed against the one before it,
  so an edited or deleted row breaks verification and the log reports which one. Records logins
  and failures, key creation and revocation, tool calls, skill imports, membership and budget
  changes. Verify on demand; export JSONL or CEF for a SIEM; retention configurable.
  Tool arguments are logged by *name* only, never by value — the log outlives the conversation.
- **Workspaces, roles and spend caps** — owner / admin / member / viewer. An admin can manage
  members but cannot mint or demote an owner, and the last owner cannot be removed. Monthly
  workspace budget, per-person allowance, or both; an over-budget request is refused with a
  message naming the limit it hit, *before* any model is called.
- **Prompt caching** — Anthropic and Qwen bill the whole prompt again each turn unless a
  `cache_control` breakpoint says otherwise; every other family on OpenRouter caches
  automatically and is left alone. The system prompt is split into a stable head and a volatile
  tail so the cached prefix stays byte-identical between turns, and `session_id` pins a
  conversation to one upstream provider so the cache is reachable. Hover a reply's cost for its
  cache split.
- **Parallel agent steps** — the planner marks which steps are independent; those run at the same
  time while dependent steps stay ordered. Resume is unchanged.
- **Queued messages** — type while a reply is streaming and it waits rather than vanishing.

### Changed

- **Auto routing tiers are derived from the live price distribution**, not from model-name
  patterns, so a vendor rename can no longer drop a flagship out of the deep tier.
- **Streaming feels like streaming** — blocks fade in as they arrive, a caret marks the write
  head, and scroll yields the moment you scroll up. One motion vocabulary across the app,
  respecting `prefers-reduced-motion`.

### Fixed

- **Artifacts report what went wrong** instead of failing to render in silence.
- **Code block text was invisible in light mode.**

---

## 2026-08-11 — Documents the model can actually read

### Added

- **DOCX support**, and **legacy `.doc`** — detected by sniffing the real format rather than
  trusting the file extension, because the two are routinely mislabelled.

### Fixed

- **An unreadable attachment is never dropped silently** — it used to disappear from the
  conversation with no indication, so the model answered as though nothing had been sent.
- **PDF text is extracted locally for every provider**, fixing both models that never received
  the text and a `DOMMatrix is not defined` crash on deployed extraction.

---

## 2026-08-01

### Fixed

- **Today's date is injected into system prompts everywhere.** Without it a model answers "this
  year" and "recently" from its training cutoff, confidently and wrongly.

---

## 2026-07-29 → 07-31 — Ready to be a public, multi-user service

### Added

- **Secrets encrypted at rest** — provider API keys, custom-tool secrets and MCP tokens encrypted
  with AES-256-GCM using a master key held only in the environment (`LIBERDE_SECRET_KEY`), never
  in the database. A database-only compromise yields ciphertext.
- **The full multi-user platform** — per-user keys, settings and data with row-level isolation
  enforced on every route; admin panel with a server-side paginated, searchable user list;
  per-user platform API keys; scheduled tasks; user-to-user sharing.
- **"How it compares" documentation** against LibreChat, Open WebUI and LobeChat.

### Fixed

- **Admin password reset is blocked for Google (OAuth) accounts** — there is no local credential
  to reset, and offering the action implied one.

---

## 2026-07-25 — Accounts you can recover

### Added

- **Password reset and email verification** (Resend), with a security-hardening pass alongside.
  A password reset invalidates every existing session.

---

## 2026-07-23 → 07-24 — Artifacts grow up

### Added

- **Second opinion** — the same question through 2–4 models in streaming columns; swap the reply
  you prefer into the thread, with the original kept as a switchable branch.
- **Design systems and sharing** — named brand specs (palette, typography, spacing, components,
  voice), lockable per design and shareable to another user.
- **Cost attribution** — every reply records its real cost and tokens, by category.
- **Link-preview cards** (Open Graph + Twitter).

### Changed

- **Edit an artifact yourself** in a syntax-highlighted editor; Adjust and comment-to-edit
  promoted to any visual artifact rather than only the design workspace.
- **Slides render on a fixed 1920×1080 canvas** with editable speaker notes in the player.
- **PDF export produces a typeset document** instead of a raw markdown dump.

### Fixed

- **Never lose a turn silently** — tool-loop budget, hard turn deadline, and a resume banner.

---

## 2026-07-21 → 07-22 — Bring your own clouds

### Added

- **OpenAI (direct) and Anthropic (direct)** as providers, routed with your own credentials.
- **Search your own past chats** — a recall tool, behind a setting that is off until enabled.

### Changed

- **Settings redesigned** — a grouped, searchable tab rail with icons on desktop; stacked tabs on
  mobile.

### Fixed

- **Stop actually stops** — it now releases the lock through a cancel endpoint. Research and image
  generation use the conversation's context rather than starting cold.
- Plan mode on cloud: a missing `agent_runs.conversation_id` migration, a reused `$9` placeholder
  causing Neon "inconsistent types deduced", and a legacy `payload` column.

---

## 2026-07-20 — First release

**Liberde** — a self-hosted, model-agnostic AI platform: streaming chat across 400+ models via
OpenRouter, artifacts, projects, **Deep Research** (plans queries, searches in parallel, streams a
cited report), agentic **Plan mode**, web search, MCP connectors, custom tools, skills, saved
prompts and memory. Shipped from day one as two editions of the same app.
