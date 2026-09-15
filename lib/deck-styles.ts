// The deck stylesheet. Every visual decision in Present mode lives here, which
// is why the model is forbidden from writing CSS: it picks a layout name and a
// theme id, and this file decides what that actually looks like.
//
// Two rules keep this file safe to inline into a srcdoc template literal:
//   1. no backticks and no dollar-brace sequences anywhere below;
//   2. no literal "</style>" (there is none).
//
// Type scale uses container query units (cqw) against the card, so a card looks
// deliberate at 380px in the side panel and at 1920px in present mode without
// a transform-scale hack. Padding stays in vw/px because a container cannot
// size its own padding from its own inline-size.

export const DECK_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;min-height:100%}
html{background:var(--bg);color:var(--ink)}
body{background:transparent;color:var(--ink);font-family:var(--body-font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{max-width:100%}

/* ---------- deck shell ---------- */
.deck{--pad:clamp(26px,4.4vw,74px);--gap:clamp(18px,2.2vw,34px);display:flex;flex-direction:column;gap:var(--gap);padding:var(--gap);max-width:1180px;margin:0 auto}
.deck[data-density="compact"]{--pad:clamp(18px,3vw,52px);--gap:clamp(12px,1.4vw,22px)}
.deck[data-density="airy"]{--pad:clamp(34px,6vw,104px);--gap:clamp(24px,3.2vw,48px)}

/* ---------- card ---------- */
.card{container-type:inline-size;container-name:card;position:relative;display:grid;align-content:center;gap:clamp(10px,1.6cqw,26px);padding:var(--pad);background-color:var(--surface);background-image:var(--card-gradient);border:var(--stroke);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;scroll-margin-top:12px}
.card[data-align="top"]{align-content:start}
.card[data-align="bottom"]{align-content:end}
.card[data-fullbleed]{padding:0}
.card[data-fullbleed] > :not(figure):not(aside):not(.ld-bg){padding-left:var(--pad);padding-right:var(--pad)}
.card > .notes,.card aside.notes{display:none !important}
/* Only cards belong at deck level. Anything else there is debris left behind
   when the runtime rescued cards out of a stray unclosed tag. */
.deck > *:not(.card):not(style):not(script){display:none}

/* ---------- typography ---------- */
.card h1,.card h2,.card h3{margin:0;font-family:var(--heading-font);font-weight:var(--heading-weight);letter-spacing:var(--heading-tracking);line-height:1.04;text-wrap:balance}
.card h1{font-size:clamp(2rem,6.6cqw,5.2rem)}
.card h2{font-size:clamp(1.5rem,4.1cqw,3.1rem);line-height:1.08}
.card h3{font-size:clamp(1.05rem,2.1cqw,1.6rem);line-height:1.2}
.card p,.card li,.card td,.card th{font-size:clamp(.95rem,1.55cqw,1.35rem);line-height:1.55}
.card p{margin:0;max-width:66ch;text-wrap:pretty}
.card .kicker{font-family:var(--heading-font);font-size:clamp(.7rem,1.05cqw,.9rem);font-weight:600;letter-spacing:.16em;text-transform:var(--kicker-transform);color:var(--accent);margin:0}
.card .lede{font-size:clamp(1.05rem,2.05cqw,1.75rem);line-height:1.4;color:var(--muted);max-width:52ch}
.card strong,.card b{font-weight:700}
.card a{color:var(--accent)}
.card ul,.card ol{margin:0;padding-left:1.15em;display:grid;gap:clamp(6px,.9cqw,14px)}
.card li{padding-left:.15em}
.card li::marker{color:var(--accent)}
.card ul[data-icons] , .card ul.icons{list-style:none;padding-left:0}
.card ul.icons > li{display:grid;grid-template-columns:auto 1fr;gap:.7em;align-items:start}
.card ul.icons > li > .ld-li{min-width:0}
.card ul.icons > li > .ld-li > b{display:block}
.card .ld-ico{width:clamp(18px,2.1cqw,30px);height:clamp(18px,2.1cqw,30px);flex:none;color:var(--accent);margin-top:.15em}
.card ul.icons > li > .ld-ico{background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:8px;padding:4px;box-sizing:content-box}

/* ---------- figures ---------- */
.card figure{margin:0;position:relative;overflow:hidden;border-radius:calc(var(--radius) * .72);background:color-mix(in srgb,var(--accent) 8%,var(--surface))}
.card figure img{display:block;width:100%;height:100%;object-fit:cover}
.card figcaption{position:absolute;left:0;right:0;bottom:0;padding:.55em .8em;font-size:clamp(.7rem,1.05cqw,.85rem);color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.62))}
.ld-ph{width:100%;height:100%;min-height:180px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));position:relative;overflow:hidden}
.ld-ph::after{content:"";position:absolute;inset:-30%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.34),transparent 45%),radial-gradient(circle at 72% 68%,rgba(255,255,255,.22),transparent 42%)}
.ld-ph .ld-ico{position:relative;z-index:1;width:22%;max-width:96px;min-width:34px;height:auto;color:#fff;opacity:.92;margin:0}

/* ---------- layouts ---------- */
.card[data-layout="title"],.card[data-layout="closing"]{place-content:center;text-align:center;justify-items:center;min-height:min(58vh,520px)}
.card[data-layout="title"] h1,.card[data-layout="closing"] h1{font-size:clamp(2.4rem,8.4cqw,6.4rem)}
.card[data-layout="title"] .lede,.card[data-layout="closing"] .lede{max-width:44ch}
/* Title art sits behind the words as a tint, not a separate block. z-index must
   stay at 0 and the text lifted above it: a negative z-index would drop the
   figure behind the card's own background and make it invisible. */
.card[data-layout="title"] > figure,.card[data-layout="closing"] > figure{position:absolute;inset:0;z-index:0;border-radius:0;opacity:.22;pointer-events:none;-webkit-mask-image:radial-gradient(120% 100% at 50% 50%,transparent 18%,#000 78%);mask-image:radial-gradient(120% 100% at 50% 50%,transparent 18%,#000 78%)}
.card[data-layout="title"] > :not(figure):not(aside),.card[data-layout="closing"] > :not(figure):not(aside){position:relative;z-index:1}

.card[data-layout="section"]{min-height:min(46vh,420px);align-content:center}
.card[data-layout="section"]::before{content:attr(data-n);position:absolute;right:clamp(10px,3cqw,54px);top:50%;transform:translateY(-50%);font-family:var(--heading-font);font-weight:800;font-size:clamp(6rem,26cqw,17rem);line-height:.8;color:var(--accent);opacity:.12;pointer-events:none}
.card[data-layout="section"] h1{font-size:clamp(2rem,7cqw,5rem)}

.card[data-layout="image-right"],.card[data-layout="image-left"]{grid-template-columns:1.08fr .92fr;align-items:center}
.card[data-layout="image-right"] > figure,.card[data-layout="image-left"] > figure{grid-row:1 / -1;align-self:stretch;min-height:clamp(200px,34cqw,520px)}
.card[data-layout="image-right"] > figure{grid-column:2}
.card[data-layout="image-right"] > :not(figure):not(aside){grid-column:1}
.card[data-layout="image-left"] > figure{grid-column:1}
.card[data-layout="image-left"] > :not(figure):not(aside){grid-column:2}
.card[data-fullbleed][data-layout="image-right"] > figure{border-radius:0;margin:calc(-1 * var(--pad)) calc(-1 * var(--pad)) calc(-1 * var(--pad)) 0}
.card[data-fullbleed][data-layout="image-left"] > figure{border-radius:0;margin:calc(-1 * var(--pad)) 0 calc(-1 * var(--pad)) calc(-1 * var(--pad))}

.card[data-layout="image-top"] > figure{min-height:clamp(160px,26cqw,400px)}
.card[data-fullbleed][data-layout="image-top"] > figure{border-radius:0;margin:calc(-1 * var(--pad)) calc(-1 * var(--pad)) 0}

.card[data-layout="image-bg"]{align-content:end;min-height:min(56vh,520px);color:#fff}
.card[data-layout="image-bg"] > figure{position:absolute;inset:0;border-radius:0;z-index:0;margin:0}
.card[data-layout="image-bg"] > :not(figure):not(aside){position:relative;z-index:2}
.card[data-layout="image-bg"] .kicker{color:#fff;opacity:.85}
.card[data-layout="image-bg"] .lede,.card[data-layout="image-bg"] p{color:rgba(255,255,255,.9)}
.card[data-layout="image-bg"]::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(0deg,rgba(0,0,0,.78),rgba(0,0,0,.18) 62%,rgba(0,0,0,.05))}
.card[data-layout="image-bg"][data-overlay="frosted"] > figure{filter:blur(9px) saturate(1.1);transform:scale(1.06)}
.card[data-layout="image-bg"][data-overlay="frosted"]::after{background:color-mix(in srgb,var(--surface) 55%,transparent)}
.card[data-layout="image-bg"][data-overlay="frosted"]{color:var(--ink)}
.card[data-layout="image-bg"][data-overlay="frosted"] .lede,.card[data-layout="image-bg"][data-overlay="frosted"] p{color:var(--ink)}
.card[data-layout="image-bg"][data-overlay="frosted"] .kicker{color:var(--accent);opacity:1}
.card[data-layout="image-bg"][data-overlay="clear"]::after{background:linear-gradient(0deg,rgba(0,0,0,.45),transparent 58%)}

.card[data-layout^="columns-"] > .ld-cols{display:grid;gap:clamp(12px,2cqw,32px)}
.card[data-layout="columns-2"] > .ld-cols{grid-template-columns:repeat(2,1fr)}
.card[data-layout="columns-3"] > .ld-cols{grid-template-columns:repeat(3,1fr)}
.card[data-layout="columns-4"] > .ld-cols{grid-template-columns:repeat(4,1fr)}
.col{display:grid;gap:.5em;align-content:start;padding:clamp(12px,1.6cqw,24px);border-radius:calc(var(--radius) * .6);background:color-mix(in srgb,var(--accent) 6%,transparent)}
.col > h3{color:var(--accent)}
.col > .ld-ico{color:var(--accent)}

.card[data-layout="stats"] > .ld-stats{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:clamp(14px,2.4cqw,40px)}
.stat{display:grid;gap:.25em;align-content:start}
.stat > b{font-family:var(--heading-font);font-weight:800;font-size:clamp(2.1rem,7.4cqw,5.4rem);line-height:.95;letter-spacing:-.03em;background:linear-gradient(120deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat > span{font-size:clamp(.82rem,1.25cqw,1.05rem);color:var(--muted);line-height:1.3}

.card[data-layout="gallery"] > .ld-gal{display:grid;grid-template-columns:repeat(auto-fit,minmax(clamp(120px,22cqw,260px),1fr));gap:clamp(10px,1.4cqw,20px)}
.card[data-layout="gallery"] .ld-gal figure{aspect-ratio:4/3}

.card[data-layout="quote"]{place-content:center;text-align:center;justify-items:center}
.card blockquote{margin:0;display:grid;gap:.7em;justify-items:center;max-width:26ch}
.card blockquote p{font-family:var(--heading-font);font-weight:var(--heading-weight);font-size:clamp(1.4rem,4.6cqw,3.4rem);line-height:1.18;letter-spacing:var(--heading-tracking);max-width:none}
.card blockquote cite{font-style:normal;font-size:clamp(.8rem,1.25cqw,1.05rem);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.card blockquote::before{content:"";width:clamp(28px,4cqw,56px);height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}

.callout{display:grid;grid-template-columns:auto 1fr;gap:.85em;align-items:start;padding:clamp(14px,1.9cqw,28px);border-radius:calc(var(--radius) * .6);background:color-mix(in srgb,var(--accent) 9%,transparent);border-left:4px solid var(--accent)}
.callout[data-kind="warn"]{background:color-mix(in srgb,#f59e0b 14%,transparent);border-left-color:#f59e0b}
.callout[data-kind="warn"] > .ld-ico{color:#b45309}
.callout[data-kind="success"]{background:color-mix(in srgb,#10b981 14%,transparent);border-left-color:#10b981}
.callout[data-kind="success"] > .ld-ico{color:#047857}
.callout[data-kind="tip"]{background:color-mix(in srgb,var(--accent-2) 14%,transparent);border-left-color:var(--accent-2)}
.callout > .ld-ico{margin-top:.1em}

.card table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.card th,.card td{text-align:left;padding:clamp(7px,1cqw,15px) clamp(8px,1.1cqw,18px);border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
.card thead th{font-family:var(--heading-font);font-weight:600;font-size:clamp(.72rem,1.05cqw,.92rem);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--accent)}
.card tbody tr:last-child th,.card tbody tr:last-child td{border-bottom:none}
.card td:not(:first-child),.card th:not(:first-child){text-align:right}
.chart-src{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ld-chart{width:100%;height:auto;overflow:visible}
.ld-chart text{font-family:var(--body-font);fill:var(--muted);font-size:13px}
.ld-chart .ld-axis{stroke:color-mix(in srgb,var(--ink) 14%,transparent);stroke-width:1}
.ld-legend{display:flex;flex-wrap:wrap;gap:.4em 1.1em;margin-top:.6em;font-size:clamp(.75rem,1.1cqw,.95rem);color:var(--muted)}
.ld-legend span{display:inline-flex;align-items:center;gap:.4em}
.ld-legend i{width:.75em;height:.75em;border-radius:3px;display:inline-block}

/* ---------- smart layouts ---------- */
.steps{list-style:none;padding:0;margin:0;counter-reset:ldstep}
.steps > li{counter-increment:ldstep;display:grid;gap:.25em}
.steps > li > b{font-family:var(--heading-font);font-weight:700;font-size:clamp(.95rem,1.75cqw,1.4rem);line-height:1.2;display:block}
.steps > li > span{font-size:clamp(.8rem,1.25cqw,1.08rem);color:var(--muted);line-height:1.4;display:block}

.card[data-layout="timeline"] .steps{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:clamp(10px,1.6cqw,26px);position:relative;padding-top:clamp(34px,4.4cqw,62px)}
.card[data-layout="timeline"] .steps::before{content:"";position:absolute;left:0;right:0;top:clamp(14px,1.9cqw,27px);height:3px;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.card[data-layout="timeline"] .steps > li::before{content:counter(ldstep);position:absolute;top:0;width:clamp(28px,3.8cqw,54px);height:clamp(28px,3.8cqw,54px);border-radius:50%;display:grid;place-items:center;background:var(--accent);color:#fff;font-family:var(--heading-font);font-weight:700;font-size:clamp(.8rem,1.4cqw,1.15rem);box-shadow:0 0 0 5px var(--surface)}
.card[data-layout="timeline"] .steps > li{position:relative;padding-top:clamp(8px,1cqw,14px)}

.card[data-layout="process"] .steps{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
.card[data-layout="process"] .steps > li{background:color-mix(in srgb,var(--accent) 10%,transparent);padding:clamp(12px,1.7cqw,26px) clamp(20px,2.6cqw,40px);clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%,22px 50%);align-content:center}
.card[data-layout="process"] .steps > li:first-child{clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%)}
.card[data-layout="process"] .steps > li:last-child{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,22px 50%)}
.card[data-layout="process"] .steps > li:nth-child(odd){background:color-mix(in srgb,var(--accent-2) 14%,transparent)}

.card[data-layout="pyramid"] .steps,.card[data-layout="funnel"] .steps{gap:6px;justify-items:center}
.card[data-layout="pyramid"] .steps > li,.card[data-layout="funnel"] .steps > li{width:var(--w,100%);text-align:center;padding:clamp(9px,1.3cqw,20px) clamp(14px,2cqw,30px);background:linear-gradient(90deg,var(--accent),var(--accent-2));color:#fff;border-radius:6px;align-content:center}
.card[data-layout="pyramid"] .steps > li > span,.card[data-layout="funnel"] .steps > li > span{color:rgba(255,255,255,.86)}
.card[data-layout="pyramid"] .steps > li:nth-child(1){--w:34%}
.card[data-layout="pyramid"] .steps > li:nth-child(2){--w:52%}
.card[data-layout="pyramid"] .steps > li:nth-child(3){--w:70%}
.card[data-layout="pyramid"] .steps > li:nth-child(4){--w:86%}
.card[data-layout="pyramid"] .steps > li:nth-child(5){--w:100%}
.card[data-layout="funnel"] .steps > li:nth-child(1){--w:100%}
.card[data-layout="funnel"] .steps > li:nth-child(2){--w:86%}
.card[data-layout="funnel"] .steps > li:nth-child(3){--w:70%}
.card[data-layout="funnel"] .steps > li:nth-child(4){--w:52%}
.card[data-layout="funnel"] .steps > li:nth-child(5){--w:36%}

.card[data-layout="staircase"] .steps{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;align-items:end;gap:clamp(6px,1cqw,14px);min-height:clamp(150px,24cqw,340px)}
.card[data-layout="staircase"] .steps > li{background:color-mix(in srgb,var(--accent) 12%,transparent);border-top:4px solid var(--accent);padding:clamp(10px,1.4cqw,20px);align-content:end;height:var(--h,100%);border-radius:8px 8px 0 0}
.card[data-layout="staircase"] .steps > li:nth-child(1){--h:38%}
.card[data-layout="staircase"] .steps > li:nth-child(2){--h:54%}
.card[data-layout="staircase"] .steps > li:nth-child(3){--h:70%}
.card[data-layout="staircase"] .steps > li:nth-child(4){--h:86%}
.card[data-layout="staircase"] .steps > li:nth-child(5){--h:100%}

.card[data-layout="cycle"] .steps{position:relative;aspect-ratio:1.55;max-width:min(100%,760px);justify-self:center;width:100%;display:block}
.card[data-layout="cycle"] .steps > li{position:absolute;left:50%;top:50%;width:clamp(96px,20cqw,210px);transform:translate(-50%,-50%) rotate(calc(var(--i) * 1turn / var(--n))) translate(clamp(70px,16cqw,205px)) rotate(calc(-1 * var(--i) * 1turn / var(--n)));text-align:center;background:var(--surface);border:2px solid var(--accent);border-radius:14px;padding:clamp(7px,1cqw,14px)}
.card[data-layout="cycle"] .steps::after{content:"";position:absolute;left:50%;top:50%;width:clamp(140px,32cqw,410px);aspect-ratio:1;transform:translate(-50%,-50%);border:3px dashed color-mix(in srgb,var(--accent) 34%,transparent);border-radius:50%}

.card[data-layout="bullseye"] .steps{position:relative;aspect-ratio:1;max-width:min(100%,520px);justify-self:center;width:100%;display:block}
.card[data-layout="bullseye"] .steps > li{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:var(--r);aspect-ratio:1;border-radius:50%;display:grid;place-content:center;text-align:center;background:color-mix(in srgb,var(--accent) calc(var(--o) * 1%),var(--surface));border:2px solid color-mix(in srgb,var(--accent) 40%,transparent);padding:0 6%}
.card[data-layout="bullseye"] .steps > li:nth-child(1){--r:34%;--o:70;z-index:4}
.card[data-layout="bullseye"] .steps > li:nth-child(2){--r:58%;--o:44;z-index:3;align-content:start;padding-top:2%}
.card[data-layout="bullseye"] .steps > li:nth-child(3){--r:80%;--o:24;z-index:2;align-content:start;padding-top:1.5%}
.card[data-layout="bullseye"] .steps > li:nth-child(4){--r:100%;--o:12;z-index:1;align-content:start;padding-top:1%}

.card[data-layout="versus"] > .ld-cols{grid-template-columns:1fr auto 1fr;align-items:stretch}
.card[data-layout="versus"] .ld-vs{align-self:center;display:grid;place-items:center;width:clamp(38px,5.4cqw,76px);height:clamp(38px,5.4cqw,76px);border-radius:50%;background:var(--accent);color:#fff;font-family:var(--heading-font);font-weight:800;font-size:clamp(.8rem,1.6cqw,1.3rem)}
.card[data-layout="versus"] .col:first-child{border-top:4px solid var(--accent)}
.card[data-layout="versus"] .col:last-child{border-top:4px solid var(--accent-2);background:color-mix(in srgb,var(--accent-2) 8%,transparent)}

.card[data-layout="quadrant"] > .ld-cols{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;aspect-ratio:1.5;max-height:60vh}
.card[data-layout="quadrant"] .col{border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);background:transparent}
.card[data-layout="quadrant"] .col:nth-child(1){background:color-mix(in srgb,var(--accent) 7%,transparent)}
.card[data-layout="quadrant"] .col:nth-child(4){background:color-mix(in srgb,var(--accent-2) 9%,transparent)}
.ld-axis-x,.ld-axis-y{color:var(--muted);font-size:clamp(.7rem,1cqw,.9rem);letter-spacing:.09em;text-transform:uppercase}
.ld-axis-y{writing-mode:vertical-rl;transform:rotate(180deg);justify-self:start}

.card[data-layout="venn"] > .ld-cols{position:relative;aspect-ratio:1.9;max-height:56vh;display:block}
.card[data-layout="venn"] .col{position:absolute;top:50%;width:52%;aspect-ratio:1;border-radius:50%;transform:translateY(-50%);display:grid;place-content:center;text-align:center;mix-blend-mode:multiply;padding:0 8%}
.card[data-layout="venn"] .col:nth-child(1){left:2%;background:color-mix(in srgb,var(--accent) 34%,var(--surface))}
.card[data-layout="venn"] .col:nth-child(2){right:2%;background:color-mix(in srgb,var(--accent-2) 34%,var(--surface))}
.card[data-layout="venn"] .col:nth-child(3){left:50%;transform:translate(-50%,-50%);background:color-mix(in srgb,var(--ink) 16%,var(--surface))}

.card[data-layout="iceberg"] > .ld-cols{grid-template-columns:1fr;gap:0;position:relative}
.card[data-layout="iceberg"] .col:first-child{background:color-mix(in srgb,var(--accent-2) 14%,transparent);border-radius:calc(var(--radius) * .6) calc(var(--radius) * .6) 0 0;clip-path:polygon(50% 0,100% 100%,0 100%);text-align:center;padding-top:clamp(18px,3cqw,44px)}
.card[data-layout="iceberg"] .col:last-child{background:color-mix(in srgb,var(--accent) 20%,transparent);border-top:3px dashed var(--accent);border-radius:0 0 calc(var(--radius) * .6) calc(var(--radius) * .6)}

.card pre{margin:0;overflow:auto;border-radius:calc(var(--radius) * .55);padding:clamp(12px,1.6cqw,24px);background:color-mix(in srgb,var(--ink) 92%,#000);color:#e2e8f0;font-size:clamp(.72rem,1.15cqw,1rem);line-height:1.55}
.card pre code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tok-k{color:#c792ea}.tok-s{color:#c3e88d}.tok-c{color:#6b7f96;font-style:italic}.tok-n{color:#f78c6c}.tok-f{color:#82aaff}.tok-a{color:#ffcb6b}

figure.embed{aspect-ratio:16/9;background:#000}
figure.embed iframe{width:100%;height:100%;border:0;display:block}
figure.embed .ld-linkcard{display:grid;place-content:center;gap:.4em;height:100%;background:color-mix(in srgb,var(--accent) 10%,var(--surface));text-align:center;padding:1em}

.card[data-layout="studio"]{padding:0}
.card[data-layout="studio"] > figure{position:absolute;inset:0;border-radius:0}

/* ---------- header / footer ---------- */
.ld-hf{position:absolute;display:flex;align-items:center;gap:.5em;font-size:clamp(.62rem,.95cqw,.82rem);color:var(--muted);letter-spacing:.06em;z-index:5;pointer-events:none}
.ld-hf img{height:clamp(14px,1.8cqw,26px);width:auto}
.ld-hf[data-pos="tl"]{top:calc(var(--pad) * .42);left:calc(var(--pad) * .55)}
.ld-hf[data-pos="tr"]{top:calc(var(--pad) * .42);right:calc(var(--pad) * .55)}
.ld-hf[data-pos="tc"]{top:calc(var(--pad) * .42);left:50%;transform:translateX(-50%)}
.ld-hf[data-pos="bl"]{bottom:calc(var(--pad) * .42);left:calc(var(--pad) * .55)}
.ld-hf[data-pos="br"]{bottom:calc(var(--pad) * .42);right:calc(var(--pad) * .55)}
.ld-hf[data-pos="bc"]{bottom:calc(var(--pad) * .42);left:50%;transform:translateX(-50%)}

/* ---------- nested cards ---------- */
.card .card{box-shadow:none;border-radius:calc(var(--radius) * .6);margin-top:.6em}
.ld-nest-pill{display:inline-flex;align-items:center;gap:.4em;cursor:pointer;font-size:clamp(.75rem,1.1cqw,.95rem);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 26%,transparent);border-radius:99px;padding:.35em .85em;width:fit-content;font-family:var(--body-font)}
.card[data-nested]{display:none}
.card[data-nested].open{display:grid}

/* ---------- formats ---------- */
.deck[data-format="document"]{max-width:860px}
.deck[data-format="document"] .card{background:transparent;background-image:none;box-shadow:none;border:none;border-radius:0;padding:clamp(14px,2vw,30px) 0;align-content:start;text-align:left;min-height:0;border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
.deck[data-format="document"] .card[data-layout="title"]{text-align:left;justify-items:start;place-content:start}
.deck[data-format="document"] .card:last-of-type{border-bottom:none}
.deck[data-format="document"] .card h1{font-size:clamp(1.9rem,4.6cqw,3.2rem)}
.deck[data-format="document"] .card h2{font-size:clamp(1.3rem,2.8cqw,2rem)}
.deck[data-format="document"][data-size="letter"] .card,.deck[data-format="document"][data-size="a4"] .card{background:var(--surface);box-shadow:var(--shadow);padding:clamp(28px,6vw,72px);margin-bottom:18px;border-bottom:none}
#ld-toc{max-width:860px;margin:0 auto;padding:var(--gap) var(--gap) 0;font-size:.92rem}
#ld-toc ol{display:grid;gap:.3em;padding-left:1.2em}
#ld-toc a{color:var(--accent);text-decoration:none}
#ld-toc a:hover{text-decoration:underline}
#ld-toc h4{margin:0 0 .5em;font:600 .72rem/1 var(--heading-font);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}

.deck[data-format="webpage"]{max-width:none;padding:0;gap:0}
.deck[data-format="webpage"] .card{border-radius:0;box-shadow:none;border:none;border-bottom:1px solid color-mix(in srgb,var(--ink) 8%,transparent);padding:clamp(48px,7vw,120px) clamp(24px,8vw,140px);min-height:auto}
.deck[data-format="webpage"] .card[data-layout="title"]{min-height:82vh}
.deck[data-format="webpage"] .card[data-layout="closing"]{background:color-mix(in srgb,var(--accent) 8%,var(--surface))}
#ld-nav{position:sticky;top:0;z-index:40;display:flex;gap:.2em;align-items:center;overflow-x:auto;padding:.7em clamp(16px,5vw,60px);background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent);font-family:var(--heading-font);font-size:.82rem}
#ld-nav a{color:var(--muted);text-decoration:none;padding:.4em .7em;border-radius:99px;white-space:nowrap}
#ld-nav a:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 6%,transparent)}
#ld-nav a.ld-brand{font-weight:700;color:var(--ink);padding-left:0}

.deck[data-format="social"]{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));max-width:1180px}
.deck[data-format="social"] .card{aspect-ratio:4/5}
.deck[data-format="social"][data-size="1x1"] .card{aspect-ratio:1}
.deck[data-format="social"][data-size="9x16"] .card{aspect-ratio:9/16}
.deck[data-format="social"] .card h1{font-size:clamp(1.6rem,8cqw,3rem)}

.deck[data-size="16x9"] .card{aspect-ratio:16/9}
.deck[data-size="4x3"] .card{aspect-ratio:4/3}
.deck[data-size="16x9"] .card,.deck[data-size="4x3"] .card{min-height:0}

/* ---------- chrome ---------- */
#ld-ctl{position:fixed;right:14px;bottom:14px;z-index:9999;display:flex;gap:2px;align-items:center;font:13px/1 ui-sans-serif,system-ui,sans-serif;background:rgba(15,17,22,.72);backdrop-filter:blur(8px);color:#fff;border-radius:999px;padding:5px 8px;box-shadow:0 8px 28px rgba(0,0,0,.28)}
#ld-ctl button{all:unset;cursor:pointer;padding:5px 9px;border-radius:999px;line-height:1;min-width:20px;text-align:center}
#ld-ctl button:hover{background:rgba(255,255,255,.18)}
#ld-ctl button[aria-pressed="true"]{background:rgba(255,255,255,.28)}
#ld-count{padding:0 6px;font-variant-numeric:tabular-nums;opacity:.85}
#ld-progress{position:fixed;left:0;top:0;height:3px;width:0;background:linear-gradient(90deg,var(--accent),var(--accent-2));z-index:9998;transition:width .25s ease;display:none}
body[data-view="present"] #ld-progress{display:block}
#ld-notes{position:fixed;left:0;right:0;bottom:0;z-index:9997;display:none;background:rgba(15,17,22,.95);color:#eee;border-top:1px solid #3a3a3a;padding:10px 16px 12px}
#ld-notes.open{display:block}
#ld-notes-head{font:600 10px/1 ui-sans-serif,system-ui;letter-spacing:.1em;text-transform:uppercase;color:#9a9a9a;margin-bottom:6px}
#ld-notes-text{width:100%;min-height:62px;max-height:30vh;box-sizing:border-box;background:transparent;color:#eee;border:none;outline:none;resize:vertical;font:13px/1.55 ui-sans-serif,system-ui}
#ld-notes-text::placeholder{color:#777}
#ld-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:10000;background:rgba(15,17,22,.9);color:#fff;font:13px/1.3 ui-sans-serif,system-ui;padding:8px 14px;border-radius:999px;opacity:0;transition:opacity .2s;pointer-events:none}
#ld-toast.on{opacity:1}

/* ---------- present view ---------- */
body[data-view="present"]{overflow:hidden}
body[data-view="present"] #ld-nav,body[data-view="present"] #ld-toc{display:none}
body[data-view="present"] .deck{display:block;padding:0;margin:0;max-width:none;gap:0}
body[data-view="present"] .deck > .card{display:none}
body[data-view="present"] .deck > .card.active{display:grid;position:fixed;inset:0;margin:auto;overflow:auto;border-radius:0;border:none;box-shadow:none;width:100vw;height:100vh;max-width:none;--pad:clamp(32px,5.2vw,110px)}
body[data-view="present"] .deck[data-size="16x9"] > .card.active{width:min(100vw,177.78vh);height:min(100vh,56.25vw)}
body[data-view="present"] .deck[data-size="4x3"] > .card.active{width:min(100vw,133.33vh);height:min(100vh,75vw)}
body[data-view="present"] .deck[data-format="social"] > .card.active{width:min(100vw,80vh);height:min(100vh,125vw);aspect-ratio:auto}
body[data-view="present"] .deck[data-format="document"] > .card.active{background:var(--surface);text-align:left}
/* A full-screen card is a different typographic problem from a card in a side
   panel: the same clamp ceilings that stop a heading shouting at 400px leave it
   looking timid at 1920px. Presenting lifts the ceilings, so a slide reads from
   the back of a room. */
body[data-view="present"] .deck > .card.active h1{font-size:clamp(2.6rem,7.4cqw,6.6rem)}
body[data-view="present"] .deck > .card.active h2{font-size:clamp(2rem,4.6cqw,4.4rem)}
body[data-view="present"] .deck > .card.active h3{font-size:clamp(1.15rem,2.3cqw,2.1rem)}
body[data-view="present"] .deck > .card.active p,body[data-view="present"] .deck > .card.active li,body[data-view="present"] .deck > .card.active td,body[data-view="present"] .deck > .card.active th{font-size:clamp(1.05rem,1.7cqw,1.9rem)}
body[data-view="present"] .deck > .card.active .lede{font-size:clamp(1.2rem,2.3cqw,2.4rem)}
body[data-view="present"] .deck > .card.active .kicker{font-size:clamp(.8rem,1.15cqw,1.15rem)}
body[data-view="present"] .deck > .card.active .stat > b{font-size:clamp(2.6rem,8.2cqw,7.2rem)}
body[data-view="present"] .deck > .card.active .stat > span{font-size:clamp(.9rem,1.35cqw,1.4rem)}
body[data-view="present"] .deck > .card.active blockquote p{font-size:clamp(1.8rem,5cqw,4.6rem)}
body[data-view="present"] .deck > .card.active .steps > li > b{font-size:clamp(1.1rem,1.95cqw,2rem)}
body[data-view="present"] .deck > .card.active .steps > li > span{font-size:clamp(.9rem,1.35cqw,1.45rem)}
.card.spot > *:not(.lit):not(aside):not(.ld-hf):not(figure){filter:blur(6px);opacity:.28;transition:filter .3s,opacity .3s}
.card.spot > *{transition:filter .3s,opacity .3s}
.card.qedit{outline:3px solid var(--accent);outline-offset:-3px}

/* ---------- presenter view ---------- */
body[data-view="presenter"]{overflow:hidden;background:#0b0d12;color:#e7e9ee}
body[data-view="presenter"] #ld-ctl{display:none}
#ld-presenter{display:none;position:fixed;inset:0;grid-template-columns:1.55fr 1fr;grid-template-rows:auto 1fr auto;gap:14px;padding:14px;font:14px/1.5 ui-sans-serif,system-ui}
body[data-view="presenter"] #ld-presenter{display:grid}
body[data-view="presenter"] .deck{position:absolute;left:-99999px;top:0}
#ld-pv-stage,#ld-pv-next{background:#11141c;border-radius:12px;overflow:hidden;position:relative;display:grid;place-items:center}
#ld-pv-stage > iframe,#ld-pv-next > iframe{border:0;background:#fff}
#ld-pv-head{grid-column:1/-1;display:flex;align-items:center;gap:14px;font-weight:600}
#ld-pv-timer{font-variant-numeric:tabular-nums;font-size:22px;letter-spacing:.02em}
#ld-pv-head button{all:unset;cursor:pointer;background:#1c2030;padding:6px 12px;border-radius:8px;font-size:13px}
#ld-pv-head button:hover{background:#28304a}
#ld-pv-notes{grid-column:1/-1;background:#11141c;border-radius:12px;padding:14px 18px;font-size:17px;line-height:1.6;overflow:auto;max-height:26vh;white-space:pre-wrap}
#ld-pv-label{position:absolute;top:8px;left:10px;font:600 10px/1 ui-sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#7c869c;z-index:2}

/* ---------- print ---------- */
@media print{
  @page{size:13.333in 7.5in;margin:0}
  html,body{background:#fff}
  #ld-ctl,#ld-notes,#ld-progress,#ld-nav,#ld-toc,#ld-toast,#ld-presenter,#liberde-err{display:none !important}
  body[data-view="present"]{overflow:visible}
  .deck{display:block !important;max-width:none;padding:0;margin:0;gap:0}
  .deck > .card{display:grid !important;position:static !important;width:100% !important;height:13.333in !important;max-width:none;break-after:page;break-inside:avoid;border-radius:0;box-shadow:none;border:none;margin:0}
  .deck[data-size="16x9"] > .card,.deck[data-size="fluid"] > .card{height:7.5in !important}
  .deck[data-size="4x3"] > .card{height:10in !important}
  .deck > .card:last-of-type{break-after:auto}
  .card.spot > *{filter:none !important;opacity:1 !important}
  .card[data-nested]{display:grid !important}
}
@media print{
  .deck[data-format="document"] > .card{height:auto !important;min-height:0 !important;break-after:auto;break-inside:auto;padding:0.6in 0.75in}
  .deck[data-format="document"][data-size="letter"]{}
  .deck[data-format="social"] > .card{height:auto !important;aspect-ratio:4/5}
}

/* ---------- narrow ---------- */
@container card (max-width: 620px){
  .card[data-layout="image-right"],.card[data-layout="image-left"]{grid-template-columns:1fr}
  .card[data-layout="image-right"] > figure,.card[data-layout="image-left"] > figure{grid-column:1 !important;grid-row:auto;min-height:170px}
  .card[data-layout="image-right"] > :not(figure):not(aside),.card[data-layout="image-left"] > :not(figure):not(aside){grid-column:1 !important}
  .card[data-layout^="columns-"] > .ld-cols{grid-template-columns:1fr !important}
  .card[data-layout="versus"] > .ld-cols{grid-template-columns:1fr !important}
  .card[data-layout="quadrant"] > .ld-cols{grid-template-columns:1fr 1fr !important;aspect-ratio:auto}
  .card[data-layout="stats"] > .ld-stats{grid-auto-flow:row;grid-template-columns:repeat(2,1fr)}
  .card[data-layout="timeline"] .steps,.card[data-layout="process"] .steps,.card[data-layout="staircase"] .steps{grid-auto-flow:row;grid-auto-columns:auto}
  .card[data-layout="process"] .steps > li{clip-path:none !important;border-radius:8px}
  .card[data-layout="staircase"] .steps > li{height:auto !important}
  .card[data-layout="timeline"] .steps{padding-top:0;padding-left:clamp(34px,9cqw,52px)}
  .card[data-layout="timeline"] .steps::before{left:clamp(15px,4.4cqw,26px);right:auto;top:0;bottom:0;width:3px;height:auto}
  .card[data-layout="timeline"] .steps > li{padding-top:0;padding-left:0}
  .card[data-layout="timeline"] .steps > li::before{left:calc(-1 * clamp(34px,9cqw,52px));top:0}
  .card[data-layout="venn"] > .ld-cols{aspect-ratio:1.2}
  .card[data-layout="cycle"] .steps{aspect-ratio:1.1}
}
@media (max-width: 640px){
  .deck{--pad:22px;--gap:14px}
  #ld-ctl{right:8px;bottom:8px;padding:7px 9px}
  #ld-ctl button{padding:8px 11px}
  #ld-presenter{grid-template-columns:1fr}
}
`;
