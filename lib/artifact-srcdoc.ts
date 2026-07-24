// Pure srcdoc builders for artifact previews — no React/browser imports so the
// server and tests can use them too.

import type { ArtifactType } from "./artifact-shared";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Safely embed arbitrary source text inside an inline <script>. */
export const embedJson = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");

export const ERROR_OVERLAY = `
<style>#liberde-err{display:none;position:fixed;inset:auto 0 0 0;max-height:45%;overflow:auto;background:#450a0a;color:#fecaca;font:12px/1.5 ui-monospace,monospace;padding:10px 14px;white-space:pre-wrap;border-top:2px solid #dc2626;z-index:99999}</style>
<div id="liberde-err"></div>
<script>
function liberdeShowErr(m){var e=document.getElementById('liberde-err');e.style.display='block';e.textContent='Error: '+m;try{parent.postMessage({__liberdeArtifactError:String(m)},'*');}catch(_){}}
window.addEventListener('error',function(e){liberdeShowErr(e.message)});
window.addEventListener('unhandledrejection',function(e){liberdeShowErr((e.reason&&e.reason.message)||String(e.reason))});
</script>`;

export function buildReactSrcDoc(source: string): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"></script>
<script type="importmap">{"imports":{
  "react":"https://esm.sh/react@18.3.1",
  "react/jsx-runtime":"https://esm.sh/react@18.3.1/jsx-runtime",
  "react-dom":"https://esm.sh/react-dom@18.3.1",
  "react-dom/client":"https://esm.sh/react-dom@18.3.1/client",
  "lucide-react":"https://esm.sh/lucide-react@0.462.0?deps=react@18.3.1",
  "recharts":"https://esm.sh/recharts@2.15.0?deps=react@18.3.1"
}}</script>
<style>html,body,#root{margin:0;min-height:100%;font-family:ui-sans-serif,system-ui,sans-serif}</style>
</head><body><div id="root"></div>${ERROR_OVERLAY}
<script>
(function(){
  var SOURCE=${embedJson(source)};
  try{
    var compiled=Babel.transform(SOURCE,{filename:'App.tsx',presets:[['react',{runtime:'automatic'}],['typescript',{isTSX:true,allExtensions:true}]]}).code;
    compiled=compiled.replace(/export\\s+default/,'const __LiberdeDefault =');
    var bootstrap=compiled+
      "\\nimport * as __React from 'react';"+
      "\\nimport { createRoot as __createRoot } from 'react-dom/client';"+
      "\\nif(typeof __LiberdeDefault==='undefined')throw new Error('The React artifact must have a default export.');"+
      "\\n__createRoot(document.getElementById('root')).render(__React.createElement(__LiberdeDefault));";
    var s=document.createElement('script');s.type='module';s.textContent=bootstrap;
    document.body.appendChild(s);
  }catch(e){liberdeShowErr(e.message||String(e))}
})();
</script></body></html>`;
}

export function buildMermaidSrcDoc(source: string): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#fff}body{display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}</style>
</head><body>${ERROR_OVERLAY}
<pre class="mermaid">${escapeHtml(source)}</pre>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });
</script></body></html>`;
}

export const buildSvgSrcDoc = (source: string) =>
  `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${source}</body>`;

/**
 * Presentation shell: the model authors <section class="slide"> blocks (plus its
 * own <style>); this chrome adds navigation (arrows/space/click), a counter,
 * and print CSS that paginates one slide per page for PDF export.
 */
export function buildSlidesSrcDoc(content: string): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;height:100%;font-family:ui-sans-serif,system-ui,sans-serif}
#liberde-deck{height:100vh;position:relative;overflow:hidden;background:#111}
/* Claude-style slide geometry: every slide is a fixed 1920x1080 (16:9) canvas,
   transform-scaled to fit whatever viewport the deck gets (canvas panel, full
   screen). Typography and layout never reflow — the slide scales as a whole. */
#liberde-deck .slide{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform:translate(-50%,-50%) scale(var(--lbs,1));display:none;flex-direction:column;justify-content:center;padding:96px 128px;box-sizing:border-box;overflow:hidden;background:#fff;box-shadow:0 12px 48px rgba(0,0,0,.55)}
#liberde-deck .slide.active{display:flex}
#liberde-ctl{position:fixed;right:14px;bottom:12px;z-index:9999;display:flex;gap:6px;align-items:center;font:13px/1 ui-sans-serif,system-ui;background:rgba(0,0,0,.55);color:#fff;border-radius:999px;padding:6px 10px}
#liberde-ctl button{all:unset;cursor:pointer;padding:2px 8px;border-radius:999px}
#liberde-ctl button:hover{background:rgba(255,255,255,.2)}
/* Speaker notes: authored as <aside class="notes"> inside each slide — never
   visible on the slide itself; surfaced only via the notes panel below. */
#liberde-deck .notes{display:none !important}
#liberde-notes{position:fixed;left:0;right:0;bottom:0;z-index:9998;display:none;background:rgba(17,17,17,.94);color:#eee;border-top:1px solid #3a3a3a;padding:10px 16px 12px;box-sizing:border-box}
#liberde-notes.open{display:block}
#lb-notes-head{font:600 10px/1 ui-sans-serif,system-ui;letter-spacing:.1em;text-transform:uppercase;color:#9a9a9a;margin-bottom:6px}
#lb-notes-text{width:100%;min-height:64px;max-height:32vh;box-sizing:border-box;background:transparent;color:#eee;border:none;outline:none;resize:vertical;font:13px/1.55 ui-sans-serif,system-ui}
#lb-notes-text::placeholder{color:#777}
@media print{
  /* 10in x 5.625in = 960x540 CSS px — exactly half the 1920x1080 canvas. */
  @page{size:10in 5.625in;margin:0}
  #liberde-ctl,#liberde-notes{display:none !important}
  #liberde-deck{height:auto;overflow:visible;background:#fff}
  #liberde-deck .slide{display:flex !important;position:relative;inset:auto;left:auto;top:auto;transform:none;zoom:0.5;width:1920px;height:1080px;box-shadow:none;page-break-after:always}
}
</style>
</head><body>${ERROR_OVERLAY}
<div id="liberde-deck">${content}</div>
<div id="liberde-ctl">
  <button id="lb-prev" title="Previous (←)">‹</button>
  <span id="lb-count"></span>
  <button id="lb-next" title="Next (→ or space)">›</button>
  <button id="lb-notes" title="Speaker notes (N)">🗒</button>
  <button id="lb-print" title="Print / save as PDF">⎙</button>
</div>
<div id="liberde-notes">
  <div id="lb-notes-head">Speaker notes · slide <span id="lb-notes-n"></span> — saved with the deck</div>
  <textarea id="lb-notes-text" placeholder="Notes for this slide… (only you see these; they stay out of PDF/PPTX slides)"></textarea>
</div>
<script>
(function(){
  var deck=document.getElementById('liberde-deck');
  var slides=Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  if(slides.length===0){
    // Fallback: treat each direct element child as a slide.
    slides=Array.prototype.filter.call(deck.children,function(el){return el.tagName!=='STYLE'&&el.tagName!=='SCRIPT'});
    slides.forEach(function(el){el.classList.add('slide')});
  }
  if(slides.length===0)return;
  var i=0;
  // Fit the fixed 1920x1080 canvas to the viewport (Claude-style photographic
  // scaling — the slide shrinks/grows as a whole, never reflows).
  function fit(){
    var s=Math.min(window.innerWidth/1920,window.innerHeight/1080);
    deck.style.setProperty('--lbs',String(s));
  }
  window.addEventListener('resize',fit);
  fit();
  var notesPanel=document.getElementById('liberde-notes');
  var notesText=document.getElementById('lb-notes-text');
  var notesN=document.getElementById('lb-notes-n');
  function noteEl(create){
    var a=slides[i].querySelector('aside.notes,.notes');
    if(!a&&create){a=document.createElement('aside');a.className='notes';slides[i].appendChild(a);}
    return a;
  }
  function loadNotes(){
    if(!notesPanel.classList.contains('open'))return;
    notesN.textContent=(i+1);
    var a=noteEl(false);
    notesText.value=a?a.textContent.trim():'';
  }
  function show(n){
    pushSave();
    i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(el,j){el.classList.toggle('active',j===i)});
    document.getElementById('lb-count').textContent=(i+1)+' / '+slides.length;
    loadNotes();
  }
  // Edits write into the slide's <aside class="notes">; the updated deck HTML
  // is handed to the host app (saved as a new version) when you pause — on
  // blur, panel close, slide change, or leaving the page — so the deck never
  // reloads under your cursor. In a standalone tab/download there is no host;
  // edits then last for the session only.
  var notesDirty=false;
  function pushSave(){
    if(!notesDirty)return;
    notesDirty=false;
    try{
      var clone=deck.cloneNode(true);
      clone.querySelectorAll('.slide').forEach(function(s){s.classList.remove('active');if(!s.className)s.removeAttribute('class');});
      parent.postMessage({__ld:'notesSaved',content:clone.innerHTML},'*');
    }catch(e){}
  }
  notesText.addEventListener('input',function(){
    var v=notesText.value;
    var a=noteEl(true);
    if(v.trim()===''){a.remove();}else{a.textContent=v;}
    notesDirty=true;
  });
  notesText.addEventListener('change',pushSave);
  notesText.addEventListener('blur',pushSave);
  window.addEventListener('pagehide',pushSave);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')pushSave();});
  // Typing in the notes box must not flip slides.
  notesText.addEventListener('keydown',function(e){e.stopPropagation();});
  function toggleNotes(){
    var open=notesPanel.classList.toggle('open');
    if(!open)pushSave();
    loadNotes();
    if(open)notesText.focus();
  }
  document.getElementById('lb-notes').onclick=toggleNotes;
  document.getElementById('lb-prev').onclick=function(){show(i-1)};
  document.getElementById('lb-next').onclick=function(){show(i+1)};
  document.getElementById('lb-print').onclick=function(){window.print()};
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(i+1);
    else if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);
    else if(e.key==='Home')show(0);
    else if(e.key==='End')show(slides.length-1);
    else if(e.key==='n'||e.key==='N')toggleNotes();
  });
  deck.addEventListener('click',function(e){
    if(e.target.closest('a,button,input,textarea,select,video,audio'))return;
    var x=e.clientX/window.innerWidth;
    if(x>0.66)show(i+1); else if(x<0.33)show(i-1);
  });
  show(0);
})();
</script></body></html>`;
}

// Secure design-canvas bridge (postMessage only — the iframe has no
// allow-same-origin, so the parent can't touch its DOM directly). Lets the
// Design studio: (1) read/live-set :root CSS custom properties for the token
// sliders, and (2) run a "comment mode" where clicking an element reports a
// description back so the user can request a targeted change.
export const DESIGN_BRIDGE = `
<script>
(function(){
  function readTokens(){
    var out=[],seen={};
    try{
      for(var i=0;i<document.styleSheets.length;i++){
        var rules;try{rules=document.styleSheets[i].cssRules}catch(_){continue}
        if(!rules)continue;
        for(var j=0;j<rules.length;j++){
          var r=rules[j];
          if(r.selectorText&&r.selectorText.indexOf(':root')!==-1&&r.style){
            for(var k=0;k<r.style.length;k++){
              var n=r.style[k];
              if(n.indexOf('--')===0&&!seen[n]){seen[n]=1;
                var v=(document.documentElement.style.getPropertyValue(n)||r.style.getPropertyValue(n)).trim();
                out.push({name:n,value:v});
              }
            }
          }
        }
      }
    }catch(_){}
    return out;
  }
  var comment=false,hov=null,prevOutline='',prevShadow='',badge=null;
  function shortLabel(el){
    var t=el.tagName.toLowerCase();
    var id=el.id?('#'+el.id):'';
    var cls=(typeof el.className==='string'&&el.className.trim())?('.'+el.className.trim().split(/\\s+/).slice(0,2).join('.')):'';
    return t+id+cls;
  }
  function desc(el){
    var t=el.tagName.toLowerCase();
    var s=(el.getAttribute&&(el.getAttribute('data-label')||el.getAttribute('aria-label')))||'';
    var txt=(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90);
    return t+(s?(' ['+s+']'):'')+(txt?(' — "'+txt+'"'):'');
  }
  function ensureBadge(){
    if(badge)return badge;
    badge=document.createElement('div');
    badge.setAttribute('data-ld-badge','1');
    badge.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;background:#d97757;color:#fff;font:600 11px/1.4 ui-sans-serif,system-ui,sans-serif;padding:2px 7px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis;display:none';
    document.body.appendChild(badge);
    return badge;
  }
  function clearHov(){if(hov){hov.style.outline=prevOutline;hov.style.boxShadow=prevShadow;hov=null;}if(badge)badge.style.display='none';}
  window.addEventListener('message',function(e){
    var d=e.data||{};
    if(d.__ld==='getTokens'){parent.postMessage({__ld:'tokens',tokens:readTokens()},'*');}
    else if(d.__ld==='setToken'){document.documentElement.style.setProperty(d.name,d.value);}
    else if(d.__ld==='comment'){comment=d.on;document.body.style.cursor=comment?'crosshair':'';if(!comment)clearHov();}
  });
  document.addEventListener('mouseover',function(e){
    if(!comment)return;
    var el=e.target;if(!el||!el.style||el.getAttribute('data-ld-badge'))return;
    if(hov){hov.style.outline=prevOutline;hov.style.boxShadow=prevShadow;}
    hov=el;prevOutline=el.style.outline;prevShadow=el.style.boxShadow;
    el.style.outline='2px solid #d97757';el.style.outlineOffset='1px';
    el.style.boxShadow='0 0 0 4px rgba(217,119,87,.18)';
    var b=ensureBadge();b.textContent=shortLabel(el);b.style.display='block';
  },true);
  document.addEventListener('mousemove',function(e){
    if(!comment||!badge||badge.style.display==='none')return;
    var x=e.clientX+12,y=e.clientY+16;
    if(x+badge.offsetWidth>window.innerWidth)x=window.innerWidth-badge.offsetWidth-4;
    if(y+badge.offsetHeight>window.innerHeight)y=e.clientY-badge.offsetHeight-8;
    badge.style.left=x+'px';badge.style.top=y+'px';
  },true);
  document.addEventListener('click',function(e){if(!comment)return;e.preventDefault();e.stopPropagation();parent.postMessage({__ld:'clicked',desc:desc(e.target),label:shortLabel(e.target)},'*');},true);
  parent.postMessage({__ld:'ready'},'*');
})();
</script>`;

export function buildSrcDoc(type: ArtifactType, content: string): string | null {
  let doc: string | null;
  switch (type) {
    case "html":
      doc = content;
      break;
    case "svg":
      doc = buildSvgSrcDoc(content);
      break;
    case "react":
      doc = buildReactSrcDoc(content);
      break;
    case "mermaid":
      doc = buildMermaidSrcDoc(content);
      break;
    case "slides":
      doc = buildSlidesSrcDoc(content);
      break;
    default:
      return null; // markdown & code render natively, not in an iframe
  }
  return doc == null ? null : doc + DESIGN_BRIDGE;
}
