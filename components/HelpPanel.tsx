"use client";

import Icon from "./Icon";

interface Doc {
  id: string;
  icon: string;
  title: string;
  blurb: string;
  points: { h: string; d: string }[];
}

const DOCS: Doc[] = [
  {
    id: "start",
    icon: "key",
    title: "Getting started",
    blurb: "Liberde runs on your own OpenRouter key — one key, hundreds of models.",
    points: [
      { h: "Add your key", d: "Settings → General → paste your key from openrouter.ai/keys and click Verify. It's stored against your account only." },
      { h: "Pick a model", d: "Use the selector top-left of any chat — or choose ✨ Auto to let Liberde route each message to the right model automatically. Not sure which specific model? Click “Help me pick” for a recommendation." },
      { h: "Start chatting", d: "Type below and hit Enter. New chat: the + in the sidebar, or Ctrl/⌘+Shift+O." },
    ],
  },
  {
    id: "models",
    icon: "grid",
    title: "Models & switching",
    blurb: "Every model on OpenRouter (plus any providers you add) in one place.",
    points: [
      { h: "✨ Auto routing", d: "Choose Auto in the selector and Liberde routes every message to the best model — quick asks to a fast, cheap model; hard reasoning to a frontier model; design work to a strong builder. The reply footer shows what it picked (Auto → model)." },
      { h: "Switch mid-chat", d: "Change the model any time — the full conversation and artifacts carry over to the new model." },
      { h: "Second opinion", d: "On any answer, click Second opinion to run the same question through 2–4 models side by side — with each one's cost — and swap in the reply you like best." },
      { h: "Set a default", d: "Settings → General — you can even set ✨ Auto as your default so new chats route automatically. Or “Set as my default” inside Help me pick." },
      { h: "Browse the catalog", d: "The Models view lists everything with pricing, context window, and capabilities." },
    ],
  },
  {
    id: "modes",
    icon: "sparkles",
    title: "Modes",
    blurb: "Toggle these under the composer for different kinds of work.",
    points: [
      { h: "🌐 Web search", d: "Pulls live results with citations. Answers link straight to sources." },
      { h: "✦ Plan", d: "Plans a goal into steps, uses tools, and delivers a finished result — resumable if it runs long." },
      { h: "🔬 Research", d: "Deep multi-round research: plans queries, searches, chases gaps in a second pass, then writes a long, cited report." },
      { h: "🎨 Image", d: "Generates images with an image-capable model (set one in Settings)." },
    ],
  },
  {
    id: "artifacts",
    icon: "file",
    title: "Artifacts & Canvas",
    blurb: "Documents, code, pages, and apps render live in a side panel.",
    points: [
      { h: "Live preview", d: "HTML, React, and docs render as the model writes them; switch between Preview and Code." },
      { h: "Versions", d: "Every edit is a version — step back through them, or pin one." },
      { h: "Canvas edits", d: "Select text or use quick-actions to ask for scoped changes without retyping context." },
      { h: "Share & remix", d: "Publish a read-only link, or remix a shared artifact into your own chat." },
      { h: "Send to a person", d: "Share → “Send to a Liberde user” by email. It lands in their “Shared with you” (sidebar), where they open their own editable copy — your original stays untouched." },
      { h: "Publish live", d: "Once published, hit Live for a real hosted public URL that serves the app/page/deck full-screen." },
      { h: "Export files", d: "Tables export to Excel (.xlsx), docs to Word, decks to PDF/PowerPoint — right from the panel." },
    ],
  },
  {
    id: "design",
    icon: "pencil",
    title: "Design studio",
    blurb: "A separate workspace for interactive prototypes, decks, and apps — switch to it with the Chat/Design toggle at the top of the sidebar.",
    points: [
      { h: "Start from a template", d: "Pitch deck, dashboard, SaaS landing, mobile flow, explainer deck, roadmap — or just describe what you want." },
      { h: "It interviews you first", d: "On a new design it asks a quick round of questions (purpose, style, palette, scope) as clickable options, then builds." },
      { h: "Design systems", d: "Save your brand — palette, fonts, spacing, components — and every design follows it. Pick one from the 🎨 chip on the Design welcome; manage them in Settings → Design systems." },
      { h: "Create from anything", d: "Describe the brand, or attach screenshots/brand assets and a vision model extracts the real colors and fonts. Remix with AI to tweak (“deeper blue, serif headings”)." },
      { h: "Share your system", d: "Share a design system to a teammate's email — it shows up in their picker, ready to apply (read-only for them)." },
      { h: "Interactive & on an artboard", d: "The design builds live and floats on a canvas — clickable prototypes, arrow-key slide decks, real states." },
      { h: "Adjust (live sliders)", d: "Open Adjust to tune the design's colors and spacing with sliders/pickers in real time, then Save." },
      { h: "Comment to edit", d: "Click Comment, click any element on the canvas, and describe the change — it edits just that part." },
      { h: "Per-slide editing", d: "For decks, the numbered 'Edit slide' bar makes a surgical change to one slide, leaving the rest intact." },
      { h: "Export", d: "Decks export to PDF and PowerPoint (.pptx); any design downloads as a self-contained file." },
      { h: "Full power", d: "Design reuses the whole chat engine, so model choice/switching, web, and attachments all work here too." },
    ],
  },
  {
    id: "connectors",
    icon: "wrench",
    title: "Connectors (MCP)",
    blurb: "Give models real tools by connecting MCP servers.",
    points: [
      { h: "Add one", d: "Settings → Connectors → Add. Use a remote (HTTP) server on the cloud; local (stdio) servers work when self-hosting." },
      { h: "See its functions", d: "After adding, Liberde discovers and lists every function the server exposes — click a connector to inspect them." },
      { h: "OAuth", d: "Servers that need sign-in show an Authorize button; finish in the popup and you're connected." },
    ],
  },
  {
    id: "skills",
    icon: "brain",
    title: "Skills",
    blurb: "Reusable know-how the model loads only when a task matches.",
    points: [
      { h: "Train with AI", d: "Settings → Skills → describe it → Draft. It writes the instructions and attaches the right tools. Pick which model drafts with the “Draft model” selector (Auto = your planner model)." },
      { h: "Bundle tools", d: "Attach connectors to a skill; when it loads, the model is told exactly which functions to use." },
      { h: "Always available", d: "The model sees each skill's name + when-to-use in every chat and pulls the full instructions on demand." },
    ],
  },
  {
    id: "projects",
    icon: "folder",
    title: "Projects & knowledge",
    blurb: "Group related chats with shared context.",
    points: [
      { h: "Create a project", d: "The + next to Projects in the sidebar. Give it instructions every chat inside inherits." },
      { h: "Add knowledge", d: "Upload files to a project; relevant chunks are retrieved into context automatically (RAG)." },
    ],
  },
  {
    id: "personal",
    icon: "users",
    title: "Memory & personalization",
    blurb: "Liberde adapts to you over time.",
    points: [
      { h: "About you & style", d: "Settings → Personal — tell it who you are, pick a response style (Concise / Explanatory / Formal / Learning), and add custom instructions; applied to every chat." },
      { h: "Memory", d: "Durable facts are saved from chats and recalled everywhere. Add, edit, or forget them in Personal." },
      { h: "Search past chats", d: "Turn on recall in Personal and the model can look things up in your own chat history (“who am I?”, “what did we decide?”)." },
      { h: "Push notifications", d: "Enable in Personal on your phone — get notified when a Plan finishes or a scheduled task completes, even with the tab closed." },
      { h: "Prompts", d: "Save reusable prompts; type “/” in the composer to insert one by name." },
    ],
  },
  {
    id: "power",
    icon: "target",
    title: "Power features",
    blurb: "Small things that add up.",
    points: [
      { h: "Command palette", d: "Ctrl/⌘+K to jump to any chat, project, model, or action." },
      { h: "Voice", d: "Dictate with the mic, or go fully hands-free with voice mode." },
      { h: "Fork / export", d: "Duplicate a chat to branch an idea, or export any chat to Markdown or PDF." },
      { h: "Usage & cost", d: "The Usage view shows spend, tokens, your balance, and “Where it goes” — model vs web search vs images. Hover any reply's cost for its own split; each reply's footer also shows its model, cost, tokens, and generation time." },
    ],
  },
  {
    id: "trouble",
    icon: "message",
    title: "Troubleshooting",
    blurb: "If something's off, start here.",
    points: [
      { h: "“Model error / no key”", d: "Re-check your OpenRouter key in Settings → General and click Verify — a wrong paste is the usual cause." },
      { h: "Grok/other model errors", d: "Some providers need enabling and a matching data policy at openrouter.ai/settings/privacy." },
      { h: "Out of credits", d: "Top up at openrouter.ai — the Usage view shows your remaining balance." },
    ],
  },
];

export default function HelpPanel() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="login-logo mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent font-display text-3xl font-bold text-white shadow-lg">
            L
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Help & docs</h1>
          <p className="mx-auto mt-2 max-w-xl text-ink-muted">
            Everything Liberde can do — your own AI workspace on top of OpenRouter.
          </p>
        </div>

        <div className="flex gap-8">
          {/* TOC */}
          <nav className="sticky top-10 hidden h-fit w-48 shrink-0 lg:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Contents
            </p>
            <ul className="space-y-1 text-sm">
              {DOCS.map((d) => (
                <li key={d.id}>
                  <a
                    href={`#help-${d.id}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon name={d.icon} size={14} /> {d.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Sections */}
          <div className="min-w-0 flex-1 space-y-6">
            {DOCS.map((d) => (
              <section
                key={d.id}
                id={`help-${d.id}`}
                className="scroll-mt-6 rounded-2xl border border-line bg-surface p-6"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                    <Icon name={d.icon} size={20} />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold">{d.title}</h2>
                    <p className="text-sm text-ink-muted">{d.blurb}</p>
                  </div>
                </div>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {d.points.map((p) => (
                    <div key={p.h} className="rounded-xl border border-line bg-bg p-3">
                      <dt className="text-sm font-medium">{p.h}</dt>
                      <dd className="mt-0.5 text-sm text-ink-muted">{p.d}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}

            <p className="pt-2 text-center text-sm text-ink-muted">
              Still stuck? Everything here is configurable in Settings. Have fun. ✦
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
