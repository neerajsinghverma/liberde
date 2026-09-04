<div align="center">

# Liberde

**A self-hosted, open-source AI platform in the style of Claude.ai — powered by [OpenRouter](https://openrouter.ai).**

One API key gives every chat access to Claude, GPT, Gemini, Llama, and 400+ other models — with artifacts, a design studio, web search, deep research, agentic plan mode, MCP connectors, custom API tools, skills, memory, projects, and a full multi-user backend.

[![Live demo](https://img.shields.io/badge/demo-liberde.ai-6d5efc)](https://liberde.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[**Live demo → liberde.ai**](https://liberde.ai) · [Features](#highlights) · [Quick start](#quick-start) · [Deploy your own](#deploy-your-own) · [Architecture](#architecture) · [Security](#security)

</div>

---

Liberde is one Next.js server that every form factor talks to — web app, an OpenAI-compatible REST API, a desktop shell, a CLI, and an installable PWA. Bring your own OpenRouter key (or plug in OpenAI, Anthropic, Azure, Bedrock, Google, or any OpenAI-compatible endpoint directly), point it at a Postgres database, and you have your own AI platform.

> ### Two editions, same app
> This repo is the **hosted / cloud** build (Postgres + Vercel) — it's what powers **[liberde.ai](https://liberde.ai)**. To run Liberde yourself with zero database setup, use the self-host build. Same features; only the storage/runtime differ.
>
> | Edition | Repo | Stack | Use it to… |
> |---|---|---|---|
> | ☁️ **Hosted / cloud** | **liberde** (this repo) | Postgres (Neon) + Vercel | deploy a public multi-user service |
> | 🖥️ **Self-host** | [**liberde-self-host**](https://github.com/neerajsinghverma/liberde-self-host) | single SQLite file, one Node process | run it yourself, no DB to provision |

## Highlights

- 🧠 **Any model, one place** — searchable picker with live pricing & context size; switch mid-conversation, or let **✨ Auto** pick the right model per message.
- 🎨 **Artifacts & a Design Studio** — versioned, publishable HTML / React / SVG / Mermaid / Markdown / code / **slide decks**, rendered live in a sandboxed iframe; a separate Design workspace builds prototypes, decks, and landing pages on a live canvas with brand-locked **design systems**.
- 🔍 **Web search & 🔬 Deep Research** — Claude-style built-in `web_search`/`fetch_page` tools with source citations, plus a research pipeline that plans, searches in parallel, and streams a cited report.
- ✦ **Agentic Plan mode** — plan-then-execute with the full tool belt, resumable across serverless invocations.
- 🐍 **Code interpreter in your browser** — the model runs real Python (pandas, numpy, matplotlib, scipy, scikit-learn) on your attached files and hands back charts and spreadsheets, in a sandboxed frame on your own machine. No sandbox service, no per-run cost, nothing to configure.
- 🔌 **MCP connectors & 🛠 custom API tools** — add any MCP server (bearer or full OAuth 2.1) *or* define your own REST endpoints as callable tools (manual, OpenAPI import, or let the model add them mid-chat).
- 📚 **Skills, memory & recall** — reusable procedures with progressive disclosure, model-editable persistent memory, and search over your own past chats.
- 👥 **Multi-user by design** — per-user keys, settings, data, and full row-level isolation; admin panel, per-user platform API keys, scheduled tasks, and user-to-user sharing.
- 🏢 **Workspaces, roles & spend caps** — group people under owner / admin / member / viewer, set a monthly budget for the workspace or per person, and have over-budget requests refused *before* a model is called.
- 🔒 **Tamper-evident audit log** — hash-chained record of logins, key creation, tool calls, skill imports and membership changes; verify the chain on demand, export JSONL or CEF straight into a SIEM.
- 💸 **Prompt caching** — explicit cache breakpoints for the model families that need them, so later turns in a long thread re-read the stable prefix at a fraction of the price. Per-message cache hits are shown next to the cost.
- ⚡ **Second opinion, voice, image gen, office exports, cost tracking, dark mode, PWA** — and a lot more below.

> 💡 **Live demo:** [liberde.ai](https://liberde.ai) runs this exact codebase.

## How it compares

Liberde isn't the only open-source AI chat app — [LibreChat](https://github.com/danny-avila/LibreChat), [Open WebUI](https://github.com/open-webui/open-webui), and [LobeChat](https://github.com/lobehub/lobe-chat) are all excellent projects. Here's where Liberde is genuinely different.

*Legend: ✅ built-in · ⚠️ partial / via plugin / community · ❌ not available. These projects all move fast — check their docs for the current state.*

| | **Liberde** | LibreChat | Open WebUI | LobeChat |
|---|:---:|:---:|:---:|:---:|
| Model access | **OpenRouter-native**<br>1 key, 400+ models | multi-provider<br>(+OpenRouter) | Ollama + OpenAI-<br>compatible | 40+ providers |
| Claude-style artifacts (versioned, live) | ✅ | ✅ | ⚠️ | ✅ |
| **Design Studio** (interactive prototypes / decks / sites) | ✅ | ❌ | ❌ | ❌ |
| **✨ Auto** per-message model routing | ✅ | ❌ | ❌ | ❌ |
| Multi-model side-by-side compare | ✅ | ❌ | ✅ | ⚠️ |
| Web search **+ deep research** | ✅ | ⚠️ | ⚠️ | ⚠️ |
| MCP connectors (stdio + HTTP + OAuth) | ✅ | ✅ | ⚠️ | ✅ |
| No-code custom REST tools (+ OpenAPI import) | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Code interpreter (Python, reads your files, no server) | ✅ | ⚠️ | ✅ | ⚠️ |
| Built-in API server + CLI + desktop + PWA | ✅ all four | ⚠️ | ⚠️ | ⚠️ |
| Cost + token **+ environmental** transparency | ✅ | ⚠️ | ⚠️ | ❌ |
| Zero-config self-host (single SQLite file) | ✅ | ❌ (MongoDB) | ✅ | ⚠️ |
| Secrets encrypted at rest (key in env) | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Tamper-evident audit log (JSONL / CEF export) | ✅ | ❌ | ❌ | ❌ |
| Workspace roles + spend caps | ✅ | ⚠️ | ⚠️ | ❌ |
| Multi-model answer **+ synthesised verdict** | ✅ | ❌ | ⚠️ | ⚠️ |

**Where Liberde stands out:** **✨ Auto** per-message routing, **cost + environmental transparency**, an **OpenRouter-native one-key** setup (400+ models, no per-provider config), **single-file self-hosting**, a **tamper-evident audit log with workspace roles and spend caps**, and shipping as a **whole platform** — web + OpenAI-compatible API + CLI + desktop + PWA — rather than just a chat UI.

A note on honesty: live artifacts, MCP and conversation branching were differentiators when this table was first written and are table stakes now — they are listed above because you should expect them, not because they set Liberde apart. The **Design Studio** is good and it is not unique either; the hosted assistants ship comparable canvases. **Browser-run Python is not a differentiator against Open WebUI**, which ships the same Pyodide approach — it is here because a code interpreter that needs no sandbox service, no credentials and no per-run billing is the right design for a self-hostable app, not because it is ours alone. What none of them can offer is running the whole thing **on your own database, under your own key, with an audit trail you can verify** — which is why that is the first thing in the list rather than the last.

## The platform

| Piece | Where | What it is |
|---|---|---|
| **Web app** | `/` (this repo) | Next.js 15 app: chat, projects, artifacts, design studio, settings |
| **Platform API** | `/v1/*` | OpenAI-compatible REST API secured by Liberde API keys |
| **Desktop app** | `apps/desktop` | Electron shell that auto-starts and wraps the web app |
| **CLI** | `apps/cli` | Zero-dependency terminal chat client (`liberde`) |
| **Mobile** | PWA | Install from the browser ("Add to Home Screen") |

Everything is a client of the one Next.js server. Data lives in **Postgres** (a free [Neon](https://neon.tech) serverless database works great) — set `DATABASE_URL`. The schema is created and migrated automatically on first run.

## Quick start

```bash
git clone https://github.com/neerajsinghverma/liberde.git
cd liberde
npm install

# Point at any Postgres database (a free Neon database works great):
echo "DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require" > .env.local

npm run build
npm start                 # → http://localhost:3000
```

On first launch the Settings dialog opens — paste an OpenRouter API key (from [openrouter.ai/keys](https://openrouter.ai/keys)). For a **single-user local** install you may instead set `OPENROUTER_API_KEY=` in `.env.local`; this shared fallback is **deliberately ignored on any multi-user or public deploy** — there, every user brings their own key so no one can spend another's.

For development: `npm run dev`.

**Optional env:**

| Variable | Enables |
|---|---|
| `DATABASE_URL` | **Required** — Postgres connection string |
| `OPENROUTER_API_KEY` | Single-user shared key (ignored on public deploys) |
| `REQUIRE_AUTH=1` | Force login even off Vercel (auto-on for Vercel) |
| `RESEND_API_KEY` | Password-reset + email-verification emails |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Sign in with Google" |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push (`npx web-push generate-vapid-keys`) |
| `CRON_SECRET` | Secures `/api/cron` for scheduled tasks on Vercel (also runs audit-log retention) |
| `LIBERDE_SECRET_KEY` | Encrypts stored secrets at rest (AES-256-GCM). **Strongly recommended for public deploys** — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and back it up |

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/neerajsinghverma/liberde&env=DATABASE_URL&envDescription=Postgres%20connection%20string%20(a%20free%20Neon%20database%20works%20great))

1. Click the button and set `DATABASE_URL` (grab a free Postgres URL from [Neon](https://neon.tech)).
2. Deploy. On Vercel, `REQUIRE_AUTH` is on automatically — the **first account you create at `/login` becomes the admin** and inherits everything.
3. Keep signups closed in **Admin** until you're ready, then flip them open.

Scheduled tasks run via **Vercel Cron** (`/api/cron`, secured by `CRON_SECRET`); **Fluid Compute** + `waitUntil` let long agent/research runs finish after the response is sent.

## Multi-user

Fresh installs run in **single-user mode** (no login) until the first account is created at `/login` — that account becomes the **admin and inherits everything** created before. After that, sign-in is required, further signups are open (close them from Admin, or set the global `allow_signups` setting to `0`), and every user has their **own** OpenRouter key, settings, chats, projects, memory, skills, connectors, custom tools, scheduled tasks, and platform API keys. Platform keys resolve to their owner, and the scheduler runs each task as its owner. Shared artifact/chat links stay public by design.

**Serverless / Vercel design choices:**
- All data access lives in `lib/db.ts` (Postgres via `@neondatabase/serverless`); schema defined + migrated idempotently at startup.
- Sessions are DB-backed opaque tokens (no in-process state); auth in `lib/auth.ts`.
- Every user-owned row carries `user_id` for full multi-user isolation.
- Scheduled tasks use **Vercel Cron**, not an in-process timer; MCP connectors are remote-HTTP (stdio needs a long-lived process, unavailable on serverless).
- Long routes (chat, agent runs, model comparison) set `maxDuration = 800` — the Pro ceiling with **Fluid Compute** on, not the 300s default. A run that would still exceed it checkpoints and resumes on the next invocation rather than being hard-killed, so a long plan survives the limit instead of racing it.

## Features

<details>
<summary><b>Full feature list</b> (click to expand)</summary>

- **Streaming chat** with stop, regenerate, and edit-and-resend
- **Any OpenRouter model**, searchable picker with pricing and context size; switch models mid-conversation
- **✨ Auto model routing** — picks the right model per message (fast / balanced / deep). Tiers are derived from the live *price* distribution rather than model-name patterns, so a vendor rename never quietly drops a flagship out of the deep tier. Most messages are placed from local signals with no extra API call; only genuinely ambiguous ones pay for a classification step. Thread stickiness prevents a follow-up dropping to the mini, and there's a runtime fallback if a routed model isn't available on your account
- **Second opinion + council verdict** — run the same question through 2–4 models side by side (streaming columns, per-model cost/tokens), then swap the reply you prefer into the thread; the original is kept as a switchable branch. When the answers land, a **separate** model writes a verdict: what they all agree on, every place they genuinely contradict each other, and one consolidated answer you can keep in a click. Real conflicts of fact or recommendation are named rather than smoothed over
- **Bring your own clouds** (Settings → Providers) — **OpenAI (direct)**, **Anthropic (direct)**, **Azure AI Foundry**, **AWS Bedrock**, **Google Gemini/Vertex**, or any **custom OpenAI-compatible endpoint** (Groq, Ollama, vLLM…). Their models appear in the picker as "Provider · model", route directly with your credentials, work with the tool loop, and are per-user with full feature parity (web search, PDF extraction, reasoning effort, cost estimates)
- **Models & pricing page** (`/models`) — the live OpenRouter catalog as browsable cards: prices, context size, capability filters (🖼 vision / 🔧 tools / 🎨 image / 🆓 free), your live credit balance and usage, one-click "Chat →" / "Set default"
- **Web search, Claude-style** — every tool-capable model gets built-in `web_search` and `fetch_page` and decides when to use them; activity trail, source cards, and citations
- **Deep Research** (🔬) — plans queries, runs parallel searches, streams a synthesized, citation-numbered report with a live progress trail
- **Plan mode** (✦) — plan-then-execute with the full tool belt (search, page reading, MCP, skills); live checklist, final deliverable (often an artifact), resumable across serverless invocations
- **MCP connectors** — add any MCP server (remote HTTP) in Settings → Connectors; tools become callable mid-conversation with a live activity trail. Remote servers support bearer tokens **and the full MCP OAuth 2.1 flow** (discovery, dynamic client registration, PKCE)
- **Custom HTTP/REST tools** — define your own API endpoints as callable tools three ways: a manual builder with a Test button, **OpenAPI 3.x import**, or let the model add one mid-chat (`create_http_tool`). Per-user encrypted secrets (redacted to the client), a write-guard on non-GET methods, and skills can bundle tools
- **Workspaces, roles and spend caps** — group people under a workspace with owner / admin / member / viewer roles. An admin can manage members but cannot mint or demote an owner, and the last owner cannot be removed. Set a monthly workspace budget, a per-person allowance, or both; an over-budget request is refused with a message naming the limit it hit, before any model is called
- **Tamper-evident audit log** (Admin → Audit) — every entry is hashed against the one before it, so an edited or deleted row breaks verification and reports which one. Records logins and failures, key creation and revocation, tool calls, skill imports, membership and budget changes. Tool arguments are logged by *name* only, never by value, because the log outlives the conversation. Verify on demand; export JSONL or CEF for a SIEM; retention is configurable and defaults to keeping everything
- **Prompt caching** — Anthropic and Qwen bill the whole prompt again each turn unless a `cache_control` breakpoint says otherwise; every other family on OpenRouter caches automatically and is left alone. The system prompt is split into a stable head and a volatile tail so the cached prefix stays byte-identical between turns, and `session_id` pins a conversation to one upstream provider so the cache is actually reachable. Hover a reply's cost to see how much of its input came from cache
- **Parallel agent steps** — the planner marks which steps are independent; those run at the same time while dependent steps stay ordered. Resume is unchanged
- **Reload mid-reply** — a reply in flight is mirrored server-side, so closing the tab or reloading picks the answer up in progress instead of showing a spinner until it lands
- **Queued messages** — type while a reply is streaming and it waits rather than vanishing; a pill shows it and it sends when the turn finishes
- **Agent Skills (SKILL.md) interop** — skills follow the open [Agent Skills](https://agentskills.io) standard, so one written for Claude Code, claude.ai, VS Code or Codex loads here unchanged, and yours export the same way. Import single files or a whole skills folder; spec fields Liberde cannot store are reported rather than dropped silently
- **Skills** — teach reusable procedures; the model sees each skill's name + description and loads full instructions only when the task matches (progressive disclosure); instructions can reference connector and custom-tool names
- **Voice conversations** (🎧) — hands-free speak/listen loop, plus 🎤 dictation
- **Editable artifacts** — ✏ edit any artifact (saves a new version), or select text and hit 💬 for a targeted change
- **Office exports** — slides → **.pptx**, markdown docs → **.doc**, alongside HTML/PDF
- **Code interpreter, in the browser** — the model writes code, runs it, and reads the output (`<liberdeRun>`). Two runtimes share the tag: JavaScript for instant arithmetic and logic checks, and **Python** — real CPython in WebAssembly with pandas, numpy, matplotlib, scipy, scikit-learn and openpyxl, loaded on demand from the code's own imports. Conversation attachments are mounted as real files at `/data`, anything written to `/out` comes back as a download (matplotlib figures are captured automatically), and the kernel is kept alive per conversation so variables and dataframes survive between blocks. It runs in a sandboxed frame with an opaque origin on the user's own machine: no server, no per-run cost, nothing to configure, and identical behaviour on a self-hosted install
- **Scheduled tasks** (⏰) — daily or every-N-hours prompts run by the scheduler, optionally with web search; each run lands in a new ⏰-prefixed conversation
- **Branching** — editing or regenerating keeps the old tail as a variant; a ⑂ switcher appears at the fork (branches never leak into each other's context)
- **Extended thinking** (💭) — streams the model's reasoning into a collapsible block with a "Thought for Ns" label
- **Image generation** (🎨) — routes the prompt to an image model (default `google/gemini-3.1-flash-image`, configurable) and shows the result in-chat
- **Memory** — persistent AND model-editable via `memory_save` / `memory_update` / `memory_forget` (id-handled facts, so updates don't duplicate); non-tool models use the `<liberdeMemory>` tag; view/delete in Settings; never active in temporary chats
- **Recall** — the model can search your own past conversations as a tool
- **Planner/executor model split** — route agent & research *planning* and step *execution* to cheaper models while the final deliverable keeps your main model
- **Projects** — group chats under shared instructions + knowledge files
- **Semantic project retrieval** — project knowledge is embedded and searched by meaning, so a paragraph that answers the question in different words is still found. Configure any OpenAI-compatible `/embeddings` endpoint (OpenAI, a local Ollama, LM Studio) via the `embedding_api_key` / `embedding_base_url` / `embedding_model` settings; files are indexed on upload. Relevance is judged **relative to the best match** rather than against a fixed score, because embedding models don't share a scale and any absolute cut-off is tuned for exactly one of them. With no endpoint configured it falls back to the lexical scorer — a knowledge base that gets less clever is fine, one that silently stops working because a key expired is not
- **Design studio** — a separate Chat/Design workspace for interactive prototypes, decks, landing pages, and apps: asks one round of clarifying questions, builds on a live canvas, supports element-select commenting, per-slide edits, live color/spacing sliders, and AI-generated imagery
- **Design systems** — save named brand specs (palette, typography, spacing, components, voice) and lock every design to one; create by describing the brand **or by attaching screenshots** (a vision model extracts real colors/fonts), "Remix with AI" to revise
- **Artifacts gallery** — every artifact you've built, and everything shared with you, in one browsable grid at `/artifacts`: card previews that pull the headings and prose out of the source (not the first 600 characters of a stylesheet) plus a strip of the artifact's own palette, filters for All / Yours / Shared with you, and full-text search across titles and contents. Opening one of yours jumps to its conversation; opening a shared one clones an editable copy
- **User-to-user sharing** — share design systems *and* artifacts to another user by email; artifacts land in their "Shared with you" view where "Open & edit a copy" clones into their own Design conversation
- **Attachments** — paste/drag images (auto-downscaled like Claude), **PDFs** (server-side text extraction), and text/code files
- **Personalization** — "about you" and "response style" custom instructions
- **Web push notifications** (VAPID) — get notified when a Plan finishes or a scheduled task completes
- **Share chats** — publish an immutable public snapshot at `/share/<id>`
- **Temporary chats** — hidden from history, no memory, auto-purged after 24h
- **Unified full-text search** across chat titles, message content, projects, knowledge files, and artifact contents
- **Cost tracking** — every reply records real OpenRouter cost and tokens (including tool rounds, searches, research, image gen), attributed by category
- **Organization** — star (pinned), archive (hidden but restorable), collapsible date-grouped history
- **Markdown** with GitHub-flavored tables and syntax highlighting, **dark/light** theme following the OS, **PWA** installable on phones

</details>

## Artifacts

Liberde implements the same artifact architecture as Claude.ai:

- Every chat's system prompt teaches the model an inline tag protocol (`<liberdeArtifact identifier=... command=create|update|rewrite>`), so artifacts work with **any** OpenRouter model — no tool-calling required.
- `update` commands are exact str-replace patches (`<liberdeOld>`/`<liberdeNew>`), applied server-side to the previous version — small edits don't regenerate the whole artifact. Every command creates a new **version**; step through them with the ‹ v2/3 › control.
- Types: `html`, `react`, `svg`, `mermaid`, `markdown`, `code`, and **`slides`** (full presentations with arrow-key navigation, ⛶ Present mode, and print-CSS pagination for PDF export). HTML/React/SVG/Mermaid render live in a **sandboxed iframe** (React compiled in-browser via Babel, deps from esm.sh; Tailwind CDN).
- **Publish** any artifact for a stable public link at `/a/<id>` (always-latest or version-pinned), or a full-screen hosted page at `/live/<id>`. Viewers can **Remix** into their own conversation.
- **The gallery** (`/artifacts`) collects everything you've made and everything shared with you, with previews, filters, and search across contents.

## Platform API

Create a key in **Settings → Platform API keys**, then call the server like any OpenAI-compatible endpoint:

```bash
curl https://your-server/v1/chat/completions \
  -H "Authorization: Bearer lbd-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

`GET /v1/models` lists models, each with a `capabilities` object (`tools`, `vision`, `structured_outputs`) so a caller can check support before spending a request. Point any OpenAI SDK at `baseURL: "https://your-server/v1"`.

**Structured outputs** are supported via `response_format`. The shape is validated server-side and the model's capability is checked first, so a bad schema or an incapable model comes back as an OpenAI-shaped error naming the actual field — rather than an opaque provider 400 mentioning something you never sent:

```json
{"error":{"message":"`strict: true` requires the root schema to set `additionalProperties: false`.",
  "type":"invalid_request_error","param":"response_format.json_schema.schema.additionalProperties",
  "code":"invalid_response_format"}}
```

## CLI

```bash
cd apps/cli
npm link                              # installs the `liberde` command
liberde config --server https://your-server --key lbd-...
liberde                               # interactive chat
liberde -p "explain CORS"             # one-shot
liberde models claude                 # filter model list
```

## Desktop app

```bash
cd apps/desktop
npm install
npm start                             # launches the shell; starts the server if needed
npm run dist                          # build a Windows installer (electron-builder)
```

Set `LIBERDE_URL` to point the shell at a remote Liberde server.

## Architecture

- `lib/db.ts` — Postgres schema + data access (`@neondatabase/serverless`)
- `lib/openrouter.ts` — upstream client, model cache, prompt assembly, Auto-routing
- `lib/auth.ts` — sessions, password hashing, lockout; `lib/ssrf.ts` — outbound-fetch guard
- `app/api/chat/route.ts` — the streaming pipeline: persists the user turn, streams SSE deltas, runs the tool loop, persists the assistant turn (also on client abort), then auto-titles new conversations
- `app/v1/*` — the public platform API; authenticates `lbd-` keys (SHA-256 hashes in `api_keys`) and proxies to OpenRouter
- `components/AppShell.tsx` — a single client shell using `history.pushState` navigation so streams survive route changes

## Security

Liberde is built to run as a public, multi-user service. Highlights:

- **Passwords** are salted **scrypt** hashes with timing-safe comparison. **Sessions** are DB-backed opaque tokens (stored hashed, expiring) in `httpOnly` + `SameSite=Lax` + `Secure` (prod) cookies; a password reset invalidates every session.
- **Multi-user isolation** — every user-owned row is scoped by `user_id`, enforced on every API route. Secrets are **redacted before reaching the client**; platform API keys are shown once and stored only as hashes.
- **Secrets encrypted at rest** — OpenRouter/provider API keys, custom-tool secrets, and MCP tokens are encrypted with **AES-256-GCM** using a master key held only in the environment (`LIBERDE_SECRET_KEY`), never in the database. A database-only compromise (leaked backup, stolen DB credentials, read replica, SQL-injection read) yields ciphertext an attacker can't read without also stealing the app environment.
- **Brute-force protection** — durable per-account lockout (10 failed logins → a temporary lock an admin can clear) plus IP rate-limiting on login, password-reset, and verification-email endpoints.
- **SSRF-guarded outbound fetches** — web fetch, custom HTTP tools, MCP connects, and OpenAPI imports validate the target host on **every redirect hop** and block loopback / private / link-local / cloud-metadata ranges; secret headers are dropped on cross-host redirects.
- **Sandboxed artifacts** — user/model-authored HTML runs in an iframe with **no `allow-same-origin`** (opaque origin), both in-app and on hosted `/live` pages (CSP `sandbox`), so artifact scripts can never touch your session or call authenticated APIs.
- **CSRF & clickjacking** — state-changing API requests are Origin-checked (null-origin sandboxed-iframe writes blocked); global `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` (except the intentionally embeddable published pages), plus `nosniff` and a strict `Referrer-Policy`.
- **Public vs private sharing** — `/share/<id>`, `/a/<id>`, `/live/<id>` are intentionally public; user-to-user shares resolve strictly by account and are read-only for recipients.
- **Cron** is secured by `CRON_SECRET` (fail-closed on Vercel).

Found something? Please open a **private security advisory** on GitHub rather than a public issue.

## Contributing

Contributions are welcome! Liberde is TypeScript + Next.js 15 (App Router).

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build / type-check
```

- Keep changes focused and match the surrounding style.
- Data access goes through `lib/db.ts`; keep every user-owned query scoped by `user_id`.
- Open an issue for anything large before starting so we can align on the approach.

## License

[MIT](LICENSE) © neerajsinghverma
