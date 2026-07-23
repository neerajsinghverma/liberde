# Liberde

A self-hosted AI platform in the style of Claude.ai, with [OpenRouter](https://openrouter.ai)
as the LLM engine — one API key gives every chat access to Claude, GPT, Gemini, Llama,
and 400+ other models.

## The platform

| Piece | Where | What it is |
|---|---|---|
| **Web app** | `/` (this folder) | Next.js 15 app: chat, projects, artifacts, settings |
| **Platform API** | `/v1/*` routes | OpenAI-compatible REST API secured by Liberde API keys |
| **Desktop app** | `apps/desktop` | Electron shell that auto-starts and wraps the web app |
| **CLI** | `apps/cli` | Zero-dependency terminal chat client (`liberde`) |
| **Mobile** | PWA | Install from the browser ("Add to Home Screen") |

Everything is a client of the one Next.js server. Data lives in **Postgres**
(a [Neon](https://neon.tech) serverless database works well) — set `DATABASE_URL`
in `.env.local`. The schema is created and migrated automatically on first run.

## Multi-user

Liberde is multi-user by design. Fresh installs run in **single-user mode** (no
login) until the first account is created at `/login` — that account becomes the
**admin and inherits everything** created before. After that, sign-in is
required, further signups are open (set the global `allow_signups` setting to
`0` to close them), and every user has their **own** OpenRouter key, settings,
chats, projects, memory, skills, connectors, scheduled tasks, and platform API
keys. Platform API keys resolve to their owner, and the task scheduler runs each
task as its owner. Shared artifact/chat links stay public by design.

**Serverless / Vercel design choices:**
- All data access lives in `lib/db.ts` (Postgres via the `@neondatabase/serverless`
  driver); the schema is defined + migrated idempotently at startup
- Sessions are DB-backed opaque tokens (no in-process state), auth in
  `lib/auth.ts`
- Every user-owned row carries `user_id` for full multi-user isolation
- Scheduled tasks run via **Vercel Cron** (`/api/cron`, secured by `CRON_SECRET`),
  not an in-process timer; **Fluid Compute** + `waitUntil` let agent runs finish
  after the response is sent; MCP connectors are remote-HTTP (stdio needs a
  long-lived process, unavailable on serverless)

## Quick start

```bash
npm install
# Set your Postgres connection string (a free Neon database works great):
echo "DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require" > .env.local
npm run build
npm start          # http://localhost:3000
```

The schema is created automatically on first run. On first launch the Settings
dialog opens — paste an OpenRouter API key (from https://openrouter.ai/keys).
Alternatively put it in `.env.local` as `OPENROUTER_API_KEY=` (see
`.env.local.example`). For web push, set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
(`npx web-push generate-vapid-keys`); for scheduled tasks on Vercel, set
`CRON_SECRET` and the cron in `vercel.json`.

For development: `npm run dev`.

## Features

- **Streaming chat** with stop, regenerate, and edit-and-resend
- **Any OpenRouter model**, searchable picker with pricing and context size;
  switch models mid-conversation
- **Second opinion** — run the same question through 2–4 models side by side
  (streaming columns, per-model cost/tokens), then swap the reply you prefer
  into the thread; the original is kept as a switchable branch
- **Bring your own clouds** (Settings → Providers) — add **OpenAI (direct)**,
  **Anthropic (direct)**, **Azure AI Foundry** deployments, **AWS Bedrock**
  models (via Bedrock API keys), **Google Gemini/Vertex**, or any **custom
  OpenAI-compatible endpoint** (Groq, Ollama, vLLM…). Their models appear in the picker as “Provider · model”, route
  directly to that cloud with your credentials, work with the tool loop, and
  are per-user — with **full feature parity**: the 🌐 Search toggle injects
  Liberde-run web results, PDFs are text-extracted server-side (pdf-parse),
  💭 Think maps to the standard `reasoning_effort` (with graceful retry), and
  cost chips work as **estimates** when you set the provider's $/1M token
  prices (external clouds report tokens, not dollars).
- **Models & pricing page** (`/models`, sidebar link) — the live OpenRouter
  catalog as browsable cards: per-1M-token prices, context size, capability
  filters (🖼 vision / 🔧 tools / 🎨 image gen / 🆓 free), sort by price,
  context, or newest (with NEW badges), your account's **live credit balance
  and usage**, and one-click "Chat →" or "Set default" per model
- **Web search, Claude-style** — every tool-capable model gets built-in
  `web_search` and `fetch_page` tools and decides on its own when to use them;
  the chat shows "🔍 Searching the web: …" activity, search cards with source
  chips, and citations under the answer. The 🌐 toggle remains as forced
  plugin-based grounding for models without tool support.
- **Deep Research** (🔬 toggle) — plans search queries, runs parallel web
  searches, and streams a synthesized, citation-numbered report with a live
  progress trail
- **Plan mode** (✦ toggle) — plan-then-execute: breaks your goal into steps,
  executes each with the full tool belt (web search, page reading, MCP
  connectors, skills), shows the live plan checklist, then streams a final
  deliverable (often an artifact) with the executed plan recorded on it —
  resumable across serverless invocations if it runs long
- **Voice conversations** (🎧 in the header) — hands-free loop: speak, hear the
  reply, speak again (plus 🎤 dictation)
- **Editable artifacts** — ✏ edit any artifact yourself (saves as a new
  version), or select text and hit 💬 to ask for a targeted change
- **Office exports** — slides → **.pptx** (PowerPoint-editable, best-effort
  text extraction) and markdown docs → **.doc** (Word-openable), alongside
  HTML/PDF
- **Unified search** — the sidebar box searches chats, messages, projects,
  knowledge files, and artifact contents, grouped by kind
- **Preset directories** — one-click popular MCP servers and skill templates in
  Settings → Connectors / Skills
- **Analysis tool** — the model can run JavaScript in a browser sandbox
  (\`<liberdeRun>\` protocol); output feeds back automatically so it can compute,
  verify, and iterate (max 4 rounds per turn)
- **Scheduled tasks** (⏰ in sidebar) — daily or every-N-hours prompts run by an
  in-server scheduler, optionally with web search; each run lands in a new
  ⏰-prefixed conversation, with pause/resume/run-now controls
- **Connectors (MCP)** — add any MCP server (local stdio command or remote HTTP)
  in Settings → Connectors; its tools become callable by tool-capable models
  mid-conversation, with a live activity trail and expandable tool-result cards.
  Remote servers support bearer tokens **and the full MCP OAuth 2.1 flow**
  (discovery, dynamic client registration, PKCE): Test surfaces a 🔐 Authorize
  button, you sign in in the browser, and tokens persist per-connector.
- **Skills** — teach the model reusable procedures in Settings → Skills. It sees
  every skill's name + description and loads the full instructions only when the
  task matches (progressive disclosure); instructions can reference connector
  tools by name.
- **Branching** — editing or regenerating keeps the old tail as a variant;
  a ⑂ switcher appears at the fork so you can flip between versions
  (ChatGPT-style; branches never leak into each other's model context)
- **Organization** — star chats (pinned section), archive them (hidden but
  restorable), date-grouped history (Today / Yesterday / Previous 7 days…)
- **Starter prompts** on the welcome screen, **Ctrl+Shift+O** new chat,
  **Ctrl+K** search, per-chat **markdown export**
- **Extended thinking** (💭 toggle) — requests reasoning tokens and streams the
  model's thought process into a collapsible block, live while it thinks, with a
  "Thought for Ns" duration label on finished replies
- **Image generation** (🎨 toggle) — routes the prompt to an image model
  (default `google/gemini-3.1-flash-image`, configurable) and shows the result in-chat
- **Memory** — persistent AND model-editable: tool-capable models manage memory
  with `memory_save` / `memory_update` / `memory_forget` (each fact carries an
  id handle, so "actually I switched teams" updates the fact instead of
  duplicating it); non-tool models fall back to the `<liberdeMemory>` tag;
  view/delete everything in Settings → Personalization; never active in
  temporary chats. Plan-mode runs share the same memory tools.
- **Recall** (Settings → Personal toggle) — the model can search your own past
  conversations as a tool, so "what did we decide last week?" actually works
- **Planner/executor model split** — optional Settings fields route agent &
  research *planning* and agent *step execution* to cheaper models while the
  final deliverable keeps your main model — big cost savings on long runs
- **Personalization** — "about you" and "response style" custom instructions
- **Web push notifications** — enable per device in Settings → Personal
  (VAPID); get notified when a Plan finishes or a scheduled task completes
- **Share chats** — publish an immutable public snapshot at `/share/<id>`
- **Temporary chats** — hidden from history, no memory, auto-purged after 24h
- **Full-text search** across chat titles *and* message content
- **Cost tracking** — every reply records its real OpenRouter cost and tokens
  (including tool rounds, web searches, research pipelines, and image gen);
  hover a reply for its cost, and the chat header shows the conversation total.
  Costs are **attributed by category** (model vs web search vs image) — the
  Usage page's "Where it goes" section shows the split, and each reply's
  tooltip shows its own breakdown
- **Auto-titled conversations** (configurable cheap "title model")
- **Projects** — group chats under shared custom instructions + knowledge files
- **Artifacts** — first-class, versioned, publishable (see below)
- **Design studio** — a separate workspace (Chat/Design switcher) for
  interactive prototypes, slide decks, landing pages, and apps: it asks one
  round of clarifying questions (clickable options), builds on a live canvas,
  and supports element-select commenting, per-slide edits, live color/spacing
  sliders, and AI-generated imagery
- **Design systems** — save named brand specs (palette, typography, spacing,
  components, voice) and pick one from the 🎨 chip so every design stays on
  brand; create by describing the brand **or by attaching screenshots/brand
  assets** (a vision model extracts real colors/fonts — model selectable),
  "Remix with AI" to revise, one default, many systems per user
- **User-to-user sharing** — share design systems *and* artifacts to another
  Liberde user by email: systems appear in their picker (read-only), artifacts
  land in their "Shared with you" sidebar view where **"Open & edit a copy"**
  clones the artifact into their own Design conversation (the original is
  untouched)
- **Attachments** — paste images anywhere on the page (screenshots included),
  drag & drop files onto the window, or upload: images (auto-downscaled to
  ~1568px like Claude, thumbnail previews, vision-model warning), **PDFs**
  (parsed via OpenRouter's free file-parser engine), and text/code files
- **Markdown** rendering with GitHub-flavored tables and syntax highlighting
- **Dark/light** theme following the OS
- **PWA** — installable on phones; serves a manifest + service worker

## Artifacts

Liberde implements the same artifact architecture as Claude.ai:

- Every chat's system prompt teaches the model an inline tag protocol
  (`<liberdeArtifact identifier=... command=create|update|rewrite>`), so artifacts
  work with **any** OpenRouter model — no tool-calling required.
- `update` commands are exact str-replace patches (`<liberdeOld>`/`<liberdeNew>`),
  applied server-side to the previous version — small edits don't regenerate the
  whole artifact. `rewrite` replaces it. Every command creates a new **version**;
  step through them with the ‹ v2/3 › control in the panel.
- Types: `html`, `react`, `svg`, `mermaid`, `markdown`, `code`, and **`slides`** —
  full presentations: the model authors styled slide sections and Liberde wraps
  them in a deck shell with arrow-key/click navigation, a slide counter, ⛶
  full-screen **Present** mode, and print CSS that paginates one slide per page
  for PDF export; downloads are self-contained playable HTML decks.
  HTML/React/SVG/Mermaid render live in a sandboxed iframe (React is compiled
  in-browser with Babel and served deps from esm.sh: react 18, lucide-react,
  recharts, Tailwind CDN). While the model is still streaming an artifact, the
  panel mirrors it live. The system prompt maps deliverables to types
  (presentation → slides, website → html, app → react, report → markdown…).
- **Publish** any artifact from the panel: you get a stable public link at `/a/<id>`
  that either always shows the latest version (default, updates propagate on every
  edit) or pins a specific version. Unpublish kills the link. Viewers can **Remix**,
  which seeds a fresh conversation with the artifact so they can iterate independently.

Engine tests: `npx tsx scripts/test-artifacts.ts` (parser/versioning),
`node scripts/test-share-http.mjs <convId>` (publish/share/remix over HTTP),
`npx tsx scripts/test-features.ts` and `node scripts/test-features-http.mjs`
(memory, temp chats, search, chat sharing, image models),
`npx tsx scripts/test-tier3.ts` and `node scripts/test-tier3-http.mjs`
(analysis tool, scheduler, research).

## Platform API

Create a key in **Settings → Platform API keys**, then call the server like any
OpenAI-compatible endpoint:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer lbd-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

`GET /v1/models` lists models. Point any OpenAI SDK at `baseURL: "http://<server>/v1"`.

## CLI

```bash
cd apps/cli
npm link                      # installs the `liberde` command
liberde config --server http://localhost:3000 --key lbd-...
liberde                       # interactive chat
liberde -p "explain CORS"     # one-shot
liberde models claude         # filter model list
```

## Desktop app

```bash
cd apps/desktop
npm install
npm start                     # launches the shell; starts the server if needed
npm run dist                  # build a Windows installer (electron-builder)
```

Set `LIBERDE_URL` to point the shell at a remote Liberde server.

## Architecture notes

- `lib/db.ts` — Postgres schema + data access (@neondatabase/serverless)
- `lib/openrouter.ts` — upstream client, model cache, prompt assembly
- `app/api/chat/route.ts` — the streaming pipeline: persists the user turn,
  streams deltas as SSE, persists the assistant turn (also on client abort),
  then auto-titles new conversations
- `app/v1/*` — the public platform API; authenticates `lbd-` keys
  (SHA-256 hashes in the `api_keys` table) and proxies to OpenRouter using
  the server's own upstream key
- The web UI is a single client shell (`components/AppShell.tsx`) using
  `history.pushState` navigation so streams survive route changes

## Security

- The OpenRouter key is stored server-side (Postgres or env) and never sent to clients
- Platform keys are shown once at creation; only hashes are stored
- Multi-user auth: DB-backed sessions (httpOnly, Secure cookies), bcrypt-hashed
  passwords, per-user row isolation on every table; once the first account
  exists, sign-in is required and signups can be closed from Admin
- Public share links (`/share/<id>`, `/a/<id>`) are intentionally public;
  user-to-user shares (projects, design systems, artifacts) resolve strictly by
  account and are read-only for recipients
