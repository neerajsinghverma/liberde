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
      { h: "Add your key", d: "Settings → General → paste your key from openrouter.ai/keys and click Verify. It's encrypted at rest and stored against your account only." },
      { h: "Pick a model", d: "Use the selector top-left of any chat — or choose ✨ Auto to let Liberde route each message to the right model automatically. Not sure which specific model? Click “Help me pick” for a recommendation." },
      { h: "How Auto decides", d: "Tiers come from where a model sits in the live price list, not from its name, so a rename never quietly drops a flagship out of the deep tier. Most messages are placed instantly from the text itself; only genuinely ambiguous ones cost a classification step. The reason for each choice is shown under the reply." },
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
      { h: "Second opinion", d: "On any answer, click Second opinion to run the same question through 2–4 models side by side, each with its own cost, and swap in the reply you like best." },
      { h: "Council verdict", d: "When the answers land, a separate model compares them: what they all agree on, every place they genuinely contradict each other, and one consolidated answer you can keep in a click. Disagreement is the point — it names real conflicts rather than smoothing them over." },
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
      { h: "✦ Plan", d: "Plans a goal into steps, uses tools, and delivers a finished result — resumable if it runs long. Independent steps run at the same time, so research that does not depend on itself finishes in one pass instead of several." },
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
      { h: "The Artifacts view", d: "Everything you have built, and everything shared with you, in one browsable grid with previews — Artifacts in the sidebar, or ⌘K. Filter by All / Yours / Shared with you and search across titles and contents. Opening one of yours jumps to its conversation; opening a shared one clones your own editable copy." },
      { h: "Live preview", d: "HTML, React, and docs render as the model writes them; switch between Preview and Code." },
      { h: "Versions", d: "Every edit is a version — step back through them, or pin one." },
      { h: "Canvas edits", d: "Select text or use quick-actions to ask for scoped changes without retyping context." },
      { h: "Share & remix", d: "Publish a read-only link, or remix a shared artifact into your own chat." },
      { h: "Send to a person", d: "Share → “Send to a Liberde user” by email. It lands under Artifacts → Shared with you, where opening it clones an editable copy into their own workspace — your original stays untouched." },
      { h: "Publish live", d: "Once published, hit Live for a real hosted public URL that serves the app/page/deck full-screen." },
      { h: "Export files", d: "Tables export to Excel (.xlsx), docs to Word, decks to PDF/PowerPoint — right from the panel." },
    ],
  },
  {
    id: "analysis",
    icon: "code",
    title: "Run code",
    blurb: "The model writes real code, runs it in your browser, and reads the result.",
    points: [
      { h: "Two runtimes", d: "JavaScript starts instantly — right for arithmetic or checking an algorithm. Python is real CPython with pandas, numpy, matplotlib, scipy and scikit-learn; importing a library is enough to load it, at the cost of a one-time runtime download the first time you use it." },
      { h: "It reads your files", d: "Every file you attach to the chat is handed to Python as a real file, so “chart this spreadsheet” works on the actual data instead of on a description of it." },
      { h: "It hands files back", d: "Anything the code produces comes back as a download — a chart, an .xlsx, a cleaned CSV. Images also appear inline." },
      { h: "It remembers", d: "Variables and dataframes stay alive between blocks in the same conversation, so a follow-up builds on the last result instead of recomputing it." },
      { h: "On your machine, not a server", d: "Code runs in a sandboxed frame in your own browser, with no access to the app, your cookies, or your network. Nothing is uploaded, no run costs anything, and it behaves identically on a self-hosted install." },
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
      { h: "Brand check", d: "When a design is locked to a system, the artifact panel reports where it drifted: colours outside the palette, fonts the system never named, and emoji used where an icon belongs. It reports rather than blocks — the check reads the source, so a colour inside a gradient can show up legitimately." },
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
    id: "agents",
    icon: "sparkles",
    title: "Agents",
    blurb: "A named configuration you start a chat as.",
    points: [
      { h: "What an agent is", d: "One name that carries a model, standing instructions, a project's knowledge, the skills it always has, and the tools it should reach for. A skill describes how to do a task and loads when one matches; a project holds documents. An agent is the thing you pick by name and talk to." },
      { h: "Make one", d: "Settings → Agents → New agent. Only a name is required — everything else narrows what it does. Give it an icon so it is recognisable in the list." },
      { h: "Start a chat as it", d: "Open a new chat: your agents appear under the greeting as chips. Click one and ask your question. The chat header shows which agent is answering, and ✕ turns it back into an ordinary chat before you send." },
      { h: "Instructions", d: "Standing instructions applied to every message in that chat — the agent's job, its rules, its house style. This is the part that does most of the work." },
      { h: "Knowledge", d: "Bind a project and every chat with the agent gets that project's files and instructions. If you start the chat inside a different project, that project wins — your explicit choice outranks the agent's default." },
      { h: "Skills it always has", d: "Normally a skill waits to be called. An agent's skills are in force from the first message, because you already said what kind of work this is by picking the agent." },
      { h: "Tools it reaches for", d: "Connectors and custom tools are callable anyway; naming them here tells the agent which ones this job is about, so it uses the right one instead of guessing." },
      { h: "Model", d: "A starting point, not a lock. Anything you or the conversation choose outranks it, because switching model mid-thread is a deliberate act an agent should not undo." },
      { h: "Deleting one", d: "Chats already started as an agent keep working and keep their history — they simply stop being bound to it." },
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
      { h: "Agent Skills standard", d: "Skills are SKILL.md files under the open Agent Skills standard, so one written for Claude Code, claude.ai, VS Code or Codex loads here unchanged — and yours export the same way. Settings → Skills → import single files or a whole skills folder; anything the spec defines that Liberde cannot store is reported rather than dropped silently." },
      { h: "Install from a link", d: "Settings → Skills → Install from a URL. Paste a link to any SKILL.md — a GitHub file page is fine — and you get the full text, the tools it wants, and anything worth a second look before it is installed. Nothing is written until you say so: a skill is prose the model then follows, so taking one from a stranger is closer to running their code than to opening their document." },
    ],
  },
  {
    id: "projects",
    icon: "folder",
    title: "Projects & knowledge",
    blurb: "Group related chats with shared context.",
    points: [
      { h: "Create a project", d: "The + next to Projects in the sidebar. Give it instructions every chat inside inherits." },
      { h: "Add knowledge", d: "Upload files to a project; only the parts relevant to what you asked are pulled into context, so a project can grow well past what would fit in a single conversation." },
      { h: "Search by meaning", d: "By default knowledge is matched on keywords. Add an embeddings endpoint in Settings → General → Semantic search and it matches on meaning instead, so a paragraph that answers your question in different words is still found. Files index as you upload; one button covers the projects you already had. If the endpoint goes away it quietly returns to keyword matching rather than failing the chat." },
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
      { h: "Prompt caching", d: "On models that support it, the unchanging part of a conversation is cached upstream, so later turns re-read it at a fraction of the price. Hover a reply's cost to see how much of its input came from cache — a long thread on Claude typically serves most of it that way." },
      { h: "Queued messages", d: "Type while a reply is still streaming and your message waits rather than vanishing. A pill above the composer shows it, and it sends the moment the reply finishes — or discard it with the ×." },
      { h: "Reload mid-reply", d: "Close the tab or reload while an answer is being written and it keeps going on the server. Come back and the partial text is already there, still filling in." },
    ],
  },
  {
    id: "teams",
    icon: "users",
    title: "Workspaces & audit",
    blurb: "Shared membership, spend limits, and a trail of what happened.",
    points: [
      { h: "Workspaces", d: "Group people under one workspace with roles: owner, admin, member, or viewer. A viewer can see the workspace but cannot spend against it, and an admin can manage members without being able to create or demote an owner." },
      { h: "Spend caps", d: "Set a monthly budget for the whole workspace, a per-person allowance, or both. A capped request is refused before any model is called, with a message saying which limit was hit and by how much — nothing is spent finding out." },
      { h: "Audit log", d: "Admins get a record of logins, key creation, tool calls, skill imports and membership changes at Settings → Audit log, where Verify chain walks every entry and names the exact one where the hashes stop agreeing. Tool arguments are recorded by name only, never by value, because the log outlives the conversation." },
      { h: "Tamper-evident", d: "Each entry is hashed against the one before it, so an edited or deleted row breaks verification and says which one. Verify the chain any time; export as JSONL or CEF for a SIEM." },

      { h: "Where workspaces live", d: "Settings → Workspaces. Create one, set a monthly cap or a per-person allowance, and add people by email with a role. An over-budget request is refused before any model is called, with a message naming the limit it hit." },
      { h: "Where the audit log lives", d: "Settings → Audit log (admins). Verify chain walks every entry and reports the exact one where the hashes stop agreeing; Export JSONL or CEF hands the whole thing to a SIEM." },    ],
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
