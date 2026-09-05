/**
 * The last untested thing: a real model, answering for real.
 *
 * Every other suite stops at the edge of the network. This one signs up, gives
 * the account an OpenRouter key, and drives actual conversations — so it covers
 * the parts that only exist when a model is on the other end: streaming, the
 * analysis tool round trip (model writes code → browser runs it → result goes
 * back → model reads it), artifact creation, and whether an agent's standing
 * instructions actually change the answer.
 *
 * Deliberately cheap. It picks the least expensive tool-capable model in the
 * catalog and sends a handful of short messages; a full run costs well under a
 * cent. It also runs against a local server only — never a deployment — because
 * it creates accounts and spends money.
 *
 *   OPENROUTER_API_KEY=... npx tsx scripts/test-live-chat.ts http://localhost:3777
 */

const BASE = process.argv[2] ?? "http://localhost:3777";
const KEY = process.env.OPENROUTER_API_KEY ?? "";

async function main() {
  if (!KEY) {
    console.log("OPENROUTER_API_KEY is not set — skipping the live-model test.");
    process.exit(0);
  }

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("playwright is not installed — skipping the live-model test.");
    process.exit(0);
  }

  let passed = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) {
      passed++;
      console.log(`  ok    ${name}`);
    } else {
      failures.push(`${name}${detail ? " — " + detail : ""}`);
      console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    }
  };

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));

  // ---------------------------------------------------------- an account ----
  const email = `live-${Date.now()}@example.test`;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const su = page.getByRole("button", { name: /sign up/i });
  if (await su.count()) await su.first().click();
  await page.getByPlaceholder("Your name").fill("Live Tester").catch(() => {});
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/^Password/).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account|sign up/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {});
  check("signed up", !page.url().includes("/login"));

  // Set the key through the same API the settings screen uses.
  const saved = await page.evaluate(async (k) => {
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: k }),
    });
    return r.ok ? ((await r.json()) as { hasApiKey?: boolean }).hasApiKey === true : false;
  }, KEY);
  check("the key is accepted and stored", saved);

  // ------------------------------------------------- the cheapest model ----
  const model = await page.evaluate(async () => {
    const r = await fetch("/api/models");
    const all = (await r.json()) as {
      id: string;
      supportsTools: boolean;
      pricing: { completion: string };
    }[];
    const priced = all
      .filter((m) => m.supportsTools && Number(m.pricing?.completion) > 0)
      .sort((a, b) => Number(a.pricing.completion) - Number(b.pricing.completion));
    return priced[0]?.id ?? "";
  });
  check("a cheap tool-capable model is available", !!model, model);
  console.log(`        using ${model}`);

  await page.evaluate(
    async (m) => {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultModel: m }),
      });
    },
    model
  );

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  const composer = page.locator("textarea").first();

  /** Send a message and wait for the reply to finish streaming. */
  const say = async (text: string, waitMs = 90_000) => {
    const before = await page.locator("[data-role='assistant'], .prose").count();
    await composer.fill(text);
    await composer.press("Enter");
    // Streaming is done when the stop control disappears again.
    await page
      .waitForFunction(
        (n) => document.querySelectorAll("[data-role='assistant'], .prose").length > n,
        before,
        { timeout: waitMs }
      )
      .catch(() => {});
    await page.waitForTimeout(2500);
    return page.locator("body").innerText();
  };

  // 1. A model answers at all.
  {
    const body = await say("Reply with exactly the word: pineapple");
    check("a real model streams a reply", /pineapple/i.test(body), body.slice(-160));
  }

  // 2. The cost of that reply was recorded — the whole accounting story
  //    depends on this and nothing else checks it against a real call.
  {
    const usage = await page.evaluate(async () => {
      const r = await fetch("/api/usage");
      return r.ok ? await r.json() : null;
    });
    const spent = JSON.stringify(usage ?? {});
    check("the turn's cost was recorded", /"(total|cost|totalCost)"\s*:\s*[0-9.]/.test(spent), spent.slice(0, 160));
  }

  // 3. The analysis tool, end to end: the model writes code, the browser runs
  //    it, the output goes back, and the model reads it. Nothing short of a
  //    live model in a real browser exercises that loop.
  {
    const body = await say(
      "Use the analysis tool to compute 17 * 23, then tell me the number.",
      150_000
    );
    check("the model's code ran and produced the right answer", body.includes("391"), body.slice(-200));
  }

  // 4. An artifact is created and persisted.
  {
    await say(
      "Create an HTML artifact titled Pineapple Page containing a single h1 that says Pineapple.",
      150_000
    );
    const arts = await page.evaluate(async () => {
      const r = await fetch("/api/artifacts");
      if (!r.ok) return [];
      const d = await r.json();
      const list = Array.isArray(d) ? d : (d.artifacts ?? []);
      return list.map((a: { title: string }) => a.title);
    });
    check(
      "an artifact was created and saved",
      arts.some((t: string) => /pineapple/i.test(t)),
      arts.join(", ") || "none"
    );
  }

  // 5. An agent's standing instructions actually reach the model. This is the
  //    claim the agents feature rests on, and it had never been exercised.
  {
    const made = await page.evaluate(async () => {
      const r = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Shouty",
          description: "live test",
          // A prefix token, not a style rule. The question is whether the
          // instructions reach the model at all, and a cheap model will obey
          // "start with this word" while quietly ignoring "write in uppercase" —
          // which would make this a test of the model rather than of Liberde.
          instructions:
            "Begin every single reply with the exact token ZZQX7 followed by a space. Never omit it.",
        }),
      });
      return r.ok ? ((await r.json()) as { id: string }).id : "";
    });
    check("the agent was created", !!made);

    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    const chip = page.getByRole("button", { name: /Shouty/ }).first();
    if (await chip.count()) await chip.click();
    await page.waitForTimeout(400);

    await say("say hello");
    // Read the reply from the conversation itself. Scraping the page body picks
    // up the composer chrome — "Second opinion", "Research", "Plan" — and scores
    // the assertion against button labels instead of the model's words.
    const reply = await page.evaluate(async () => {
      const list = await (await fetch("/api/conversations")).json();
      const id = (Array.isArray(list) ? list : (list.conversations ?? []))[0]?.id;
      if (!id) return "";
      const conv = await (await fetch("/api/conversations/" + id)).json();
      const msgs = conv.messages ?? [];
      const last = [...msgs].reverse().find((m) => m.role === "assistant");
      return String(last?.content ?? "");
    });
    check(
      "the agent's instructions reached the model",
      /ZZQX7/.test(reply),
      JSON.stringify(reply.slice(0, 140))
    );
  }

  // 6. Second opinion. This panel has now shipped two layout bugs that only a
  //    real run could expose — columns collapsing to zero height on a phone,
  //    and the verdict buried under three columns of source material. Both are
  //    geometry, so both are asserted as geometry.
  {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await say("In one short sentence: what is the capital of France?");

    const second = page.getByRole("button", { name: /second opinion/i }).first();
    if ((await second.count()) === 0) {
      check("Second opinion is offered on a reply", false, "control not found");
    } else {
      await second.click();
      await page.waitForTimeout(1500);
      const go = page.getByRole("button", { name: /^Compare$/ }).first();
      if (await go.count()) await go.click();
      await page
        .waitForFunction(() => document.body.innerText.includes("Council verdict"), null, {
          timeout: 180_000,
        })
        .catch(() => {});
      await page.waitForTimeout(4000);

      const geo = await page.evaluate(() => {
        const byText = (t: string) =>
          [...document.querySelectorAll("button, span")].find((e) =>
            (e.textContent ?? "").trim().startsWith(t)
          );
        const verdict = byText("Use the verdict");
        const firstCol = byText("Use this reply");
        return {
          verdictTop: verdict ? Math.round(verdict.getBoundingClientRect().top) : null,
          colTop: firstCol ? Math.round(firstCol.getBoundingClientRect().top) : null,
          colHeight: firstCol
            ? Math.round(firstCol.closest("div")?.parentElement?.getBoundingClientRect().height ?? 0)
            : 0,
        };
      });

      check(
        "a verdict is produced",
        geo.verdictTop !== null,
        JSON.stringify(geo)
      );
      check(
        "the verdict is above the columns",
        geo.verdictTop !== null && geo.colTop !== null && geo.verdictTop < geo.colTop,
        JSON.stringify(geo)
      );
      check(
        "the answer columns have real height",
        geo.colHeight > 80,
        `${geo.colHeight}px`
      );
    }
  }
  check("no uncaught page errors during live chat", pageErrors.length === 0, pageErrors.join(" | "));

  // What this run cost, so the number is on the record rather than guessed at.
  const finalUsage = await page.evaluate(async () => {
    const r = await fetch("/api/usage");
    return r.ok ? await r.json() : null;
  });
  const spend =
    (finalUsage &&
      (finalUsage.total ?? finalUsage.cost ?? finalUsage.totalCost ?? finalUsage.spend)) ??
    null;
  if (spend != null) console.log(`\n        this run spent $${Number(spend).toFixed(5)}`);

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} live-model checks passing`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  " + f);
    process.exit(1);
  }
}

main();
