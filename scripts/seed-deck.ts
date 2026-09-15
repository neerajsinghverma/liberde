/* Seed a Present-mode conversation: an editable outline, then the deck it made.
 * Used by test-present-ui.ts to exercise the UI without spending a model call. */
import { addMessage, createConversation, updateConversation } from "../lib/db";
import { processAssistantArtifacts } from "../lib/artifacts";

/** Optional: seed into a specific account, so a signed-in UI test can see it. */
const USER_ID = process.argv[2];
/** --outline-only stops before the deck, so the outline is still editable. */
const OUTLINE_ONLY = process.argv.includes("--outline-only");

async function main() {
 const conv = await createConversation(
  "anthropic/claude-sonnet-4",
  null,
  false,
  USER_ID || undefined,
  "present"
);

 await addMessage(conv.id, "user", "A pitch deck for a B2B analytics startup.\n\nSettings: presentation · 6 cards · medium text · themed graphics · fluid");

 await addMessage(
  conv.id,
  "assistant",
  `Aurora fits a startup pitch — optimistic and modern without being loud. Here is the outline.

<liberdeOutline>{"title":"Northwind Analytics","settings":{"format":"presentation","cards":6,"text":"medium","images":"themed","size":"fluid","theme":"aurora","density":"medium","tone":"confident, plain-spoken","audience":"seed investors","language":"en"},"cards":[{"title":"Analytics that answer","layout":"title","summary":"Company name and one-line promise"},{"title":"Dashboards do not answer questions","layout":"text","summary":"The problem, in one idea"},{"title":"Ask in plain English","layout":"image-right","summary":"What the product does"},{"title":"Traction","layout":"stats","summary":"Growth, volume, design partners"},{"title":"Roadmap","layout":"timeline","summary":"Three quarters"},{"title":"Thanks","layout":"closing","summary":"The ask and contact"}]}</liberdeOutline>`
);

 if (OUTLINE_ONLY) {
  await updateConversation(conv.id, { title: "Northwind Analytics (outline)" });
  console.log(JSON.stringify({ conversationId: conv.id }));
  process.exit(0);
}

 const built = await addMessage(
  conv.id,
  "assistant",
  `Built it in Aurora — six cards, one idea each.

<liberdeArtifact identifier="deck" command="create" type="deck" title="Northwind Analytics">
<div class="deck" data-theme="aurora" data-format="presentation" data-size="fluid" data-density="medium">
<section class="card" data-layout="title">
<p class="kicker">Seed round</p>
<h1>Analytics that answer</h1>
<p class="lede">Ask your warehouse a question. Get an answer, not a dashboard.</p>
<figure data-placeholder="abstract data network" data-icon="rocket"></figure>
<aside class="notes">Open with the promise, then pause before the problem.</aside>
</section>
<section class="card" data-layout="text">
<h2>Dashboards do not answer questions</h2>
<ul>
<li data-icon="clock">Every answer waits on an analyst</li>
<li data-icon="warn">Reports go stale the week they ship</li>
<li data-icon="money">Teams pay for seats nobody opens</li>
</ul>
<aside class="notes">Three symptoms of one disease: the question and the data never meet.</aside>
</section>
<section class="card" data-layout="image-right">
<h2>Ask in plain English</h2>
<p>Northwind reads your warehouse schema and answers in the tools you already use.</p>
<figure data-placeholder="conversation interface" data-icon="search"></figure>
<aside class="notes">Demo lives here if there is time.</aside>
</section>
<section class="card" data-layout="stats">
<h2>Traction</h2>
<div class="stat"><b>42%</b><span>MoM revenue growth</span></div>
<div class="stat"><b>1.2M</b><span>Questions answered</span></div>
<div class="stat"><b>18</b><span>Design partners</span></div>
<aside class="notes">Lead with 42 percent and let it sit.</aside>
</section>
<section class="card" data-layout="timeline">
<h2>Roadmap</h2>
<ol class="steps">
<li><b>Q1</b><span>Warehouse connectors</span></li>
<li><b>Q2</b><span>Semantic layer</span></li>
<li><b>Q3</b><span>Autonomous agents</span></li>
</ol>
<aside class="notes">Say what is already shipped versus planned.</aside>
</section>
<section class="card" data-layout="closing">
<h1>Thanks</h1>
<p class="lede">Raising $4M to take this to every analyst.</p>
<aside class="notes">Stop talking. Take questions.</aside>
</section>
</div>
</liberdeArtifact>`
);
 await processAssistantArtifacts(conv.id, built.id, built.content);
 await updateConversation(conv.id, { title: "Northwind Analytics" });

 console.log(JSON.stringify({ conversationId: conv.id }));
}

main();
