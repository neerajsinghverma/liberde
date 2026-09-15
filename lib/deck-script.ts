// The deck runtime script. Injected into every deck preview, published page and
// downloaded file, so a deck is a self-contained document that still works with
// no network and no host app.
//
// It takes the model's semantic markup and does all the work the model is not
// allowed to do: wraps columns/stats/galleries into grid containers, draws
// icons, charts and smart-layout geometry, builds nav/TOC, and runs the three
// views (scroll, present, presenter) with spotlight, notes and quick edit.
//
// Constraints so this can be inlined into a srcdoc template literal and into a
// <script> tag: no backticks, no dollar-brace sequences, and no literal
// "</script>" (the one place that sequence is needed is split with a backslash).
//
// Globals supplied by buildDeckSrcDoc before this runs: LD_FONTS (theme id ->
// Google Fonts query), LD_VIEW ("scroll" | "present" | "presenter").

export const DECK_JS = `
(function(){
"use strict";
var doc=document, root=doc.getElementById('ld-root');
if(!root) return;
var FONTS=(typeof LD_FONTS!=='undefined')?LD_FONTS:{};
var START=(typeof LD_VIEW!=='undefined')?LD_VIEW:'scroll';

/* ------------------------------------------------------------------ setup */
var deck=root.querySelector('.deck');
if(!deck){
  deck=doc.createElement('div');
  deck.className='deck';
  while(root.firstChild) deck.appendChild(root.firstChild);
  root.appendChild(deck);
}
/* Pristine copy, captured before a single mutation. Every save re-serialises
   from this instead of the live DOM, so nothing the runtime injects (icons,
   chart SVG, wrappers) can ever leak back into the model's markup. */
var SRC=deck.outerHTML;

if(!deck.getAttribute('data-theme')) deck.setAttribute('data-theme','slate');
if(!deck.getAttribute('data-format')) deck.setAttribute('data-format','presentation');
if(!deck.getAttribute('data-size')) deck.setAttribute('data-size','fluid');
if(!deck.getAttribute('data-density')) deck.setAttribute('data-density','medium');

var cards=[];
function collect(){
  cards=[];
  /* Recover from unbalanced markup before counting anything. A single unclosed
     inline tag — an <b> inside one stat is the way this actually happens —
     makes the browser nest every following <section> inside it, so half the
     deck silently disappears from deck.children. Observed 2026-09-15: a live
     model wrote 8 cards and 4 rendered. Any card that is not a direct child is
     adopted back onto the deck; querySelectorAll walks in document order and a
     swallowed card always follows the card that swallowed it, so appending in
     that order puts the deck back in its intended sequence. */
  var stray=deck.querySelectorAll('section.card,section[data-layout]');
  for(var s=0;s<stray.length;s++){
    var el=stray[s];
    if(el.parentNode===deck) continue;
    if(el.hasAttribute('data-nested')) continue;
    if(el.closest&&el.closest('section[data-nested]')) continue;
    deck.appendChild(el);
  }
  var kids=deck.children;
  for(var i=0;i<kids.length;i++){
    var el=kids[i];
    if(el.tagName==='SECTION'||(el.classList&&el.classList.contains('card'))){
      if(el.tagName==='STYLE'||el.tagName==='SCRIPT') continue;
      if(el.hasAttribute('data-nested')) continue;
      el.classList.add('card');
      cards.push(el);
    }
  }
  for(var j=0;j<cards.length;j++){
    cards[j].setAttribute('data-n',String(j+1));
    if(!cards[j].id) cards[j].id='card-'+(j+1);
  }
}
collect();
if(!cards.length) return;

/* ----------------------------------------------------------------- theme */
var fontLink=null;
function applyTheme(){
  var id=deck.getAttribute('data-theme')||'slate';
  doc.documentElement.setAttribute('data-theme',id);
  var q=FONTS[id];
  if(!q) return;
  var href='https://fonts.googleapis.com/css2?'+q+'&display=swap';
  if(fontLink&&fontLink.getAttribute('href')===href) return;
  if(!fontLink){
    fontLink=doc.createElement('link');
    fontLink.rel='stylesheet';
    doc.head.appendChild(fontLink);
  }
  fontLink.setAttribute('href',href);
}
applyTheme();

function cssVar(name){
  var v=getComputedStyle(deck).getPropertyValue(name);
  return (v||'').trim();
}

/* ----------------------------------------------------------------- icons */
var ICONS={
  check:'M20 6 9 17l-5-5',
  arrow:'M5 12h14M13 6l6 6-6 6',
  star:'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
  rocket:'M5 13c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3 1-3a12 12 0 0 1 9-6 12 12 0 0 1-6 9zM15 9h.01',
  target:'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0 5 5 0 1 0-10 0M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0',
  bolt:'M13 2 4 14h7l-1 8 9-12h-7z',
  chart:'M3 20h18M7 20V10M12 20V4M17 20v-7',
  users:'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6M22 20v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  shield:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  clock:'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3 2',
  globe:'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18',
  lightbulb:'M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 2z',
  lock:'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  money:'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  cloud:'M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.7 1.5A3.5 3.5 0 0 0 6.5 19z',
  code:'M8 6 2 12l6 6M16 6l6 6-6 6',
  search:'M11 11m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0M21 21l-5-5',
  heart:'M19 6a5 5 0 0 0-7 0l-.5.5L11 6A5 5 0 0 0 4 13l8 8 8-8a5 5 0 0 0-1-7z',
  warn:'M12 3 2 20h20zM12 9v5M12 17h.01',
  info:'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 11v5M12 8h.01',
  calendar:'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  gear:'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2 1.2L10 21h4l.4-2.7c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.2-.8.2-1.2z',
  layers:'M12 2 2 8l10 6 10-6zM2 14l10 6 10-6M2 11l10 6 10-6',
  play:'M6 3l14 9-14 9z',
  plus:'M12 5v14M5 12h14',
  book:'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM18 20a3 3 0 0 1 3-3h-3',
  pin:'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 10m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0'
};
function iconSvg(name){
  var d=ICONS[name]||ICONS.check;
  var s=doc.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('viewBox','0 0 24 24');
  s.setAttribute('fill','none');
  s.setAttribute('stroke','currentColor');
  s.setAttribute('stroke-width','1.9');
  s.setAttribute('stroke-linecap','round');
  s.setAttribute('stroke-linejoin','round');
  s.setAttribute('class','ld-ico');
  s.setAttribute('aria-hidden','true');
  var p=doc.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d',d);
  s.appendChild(p);
  return s;
}

/* ------------------------------------------------------- normalise a card */
function wrapRun(card,selector,cls){
  var items=[],kids=card.children,i;
  for(i=0;i<kids.length;i++){ if(kids[i].matches&&kids[i].matches(selector)) items.push(kids[i]); }
  if(!items.length) return null;
  var box=doc.createElement('div');
  box.className=cls;
  card.insertBefore(box,items[0]);
  for(i=0;i<items.length;i++) box.appendChild(items[i]);
  return box;
}

function normalise(card){
  var layout=card.getAttribute('data-layout')||'text';

  /* columns / versus / quadrant / venn / iceberg share the .col child shape */
  if(layout.indexOf('columns-')===0||layout==='versus'||layout==='quadrant'||layout==='venn'||layout==='iceberg'){
    var cols=wrapRun(card,'.col','ld-cols');
    if(cols&&layout==='versus'&&cols.children.length===2){
      var vs=doc.createElement('div');
      vs.className='ld-vs';
      vs.textContent='VS';
      cols.insertBefore(vs,cols.children[1]);
    }
    if(cols&&layout==='quadrant'){
      var ax=card.getAttribute('data-x'),ay=card.getAttribute('data-y');
      if(ax){ var xl=doc.createElement('div'); xl.className='ld-axis-x'; xl.textContent=ax; card.appendChild(xl); }
      if(ay){ var yl=doc.createElement('div'); yl.className='ld-axis-y'; yl.textContent=ay; card.insertBefore(yl,cols); }
    }
  }
  if(layout==='stats') wrapRun(card,'.stat','ld-stats');
  if(layout==='gallery') wrapRun(card,'figure','ld-gal');

  /* icon bullets */
  var lists=card.querySelectorAll('ul');
  for(var li=0;li<lists.length;li++){
    var ul=lists[li];
    if(!ul.querySelector('li[data-icon]')&&layout!=='bullets') continue;
    ul.classList.add('icons');
    var items=ul.children;
    for(var k=0;k<items.length;k++){
      var it=items[k];
      if(it.querySelector&&it.querySelector('.ld-ico')) continue;
      /* Wrap the text FIRST. The li is a two-column grid (icon, content), and a
         bare text node beside a <b> would become its own anonymous grid item
         and wrap onto a second row — which reads as a broken bullet. */
      var span=doc.createElement('span');
      span.className='ld-li';
      while(it.firstChild) span.appendChild(it.firstChild);
      it.appendChild(span);
      it.insertBefore(iconSvg(it.getAttribute('data-icon')||'check'),it.firstChild);
    }
  }
  /* icons on callouts and columns */
  var marks=card.querySelectorAll('.callout[data-icon],.col[data-icon],.ld-ph[data-icon]');
  for(var m=0;m<marks.length;m++){
    if(marks[m].querySelector('.ld-ico')) continue;
    marks[m].insertBefore(iconSvg(marks[m].getAttribute('data-icon')),marks[m].firstChild);
  }
  var calls=card.querySelectorAll('.callout:not([data-icon])');
  for(var c=0;c<calls.length;c++){
    if(calls[c].querySelector('.ld-ico')) continue;
    var kind=calls[c].getAttribute('data-kind')||'info';
    var ic=kind==='warn'?'warn':kind==='success'?'check':kind==='tip'?'lightbulb':'info';
    calls[c].insertBefore(iconSvg(ic),calls[c].firstChild);
  }

  /* figures: real images get a fallback, placeholders get a themed tile */
  var figs=card.querySelectorAll('figure');
  for(var f=0;f<figs.length;f++) prepFigure(figs[f]);

  /* smart-layout geometry that CSS alone cannot express */
  if(layout==='cycle'||layout==='bullseye'){
    var steps=card.querySelector('.steps');
    if(steps){
      var n=steps.children.length;
      steps.style.setProperty('--n',String(n));
      for(var s=0;s<n;s++) steps.children[s].style.setProperty('--i',String(s));
    }
  }

  /* charts, code, embeds */
  var tables=card.querySelectorAll('table[data-chart]');
  for(var t=0;t<tables.length;t++) drawChart(tables[t]);
  var codes=card.querySelectorAll('pre > code');
  for(var cd=0;cd<codes.length;cd++) highlight(codes[cd]);
  var embeds=card.querySelectorAll('figure.embed[data-src]');
  for(var e=0;e<embeds.length;e++) mountEmbed(embeds[e]);

  /* nested cards become a pill the reader opens */
  var nested=card.querySelectorAll('.card[data-nested],section[data-nested]');
  for(var nx=0;nx<nested.length;nx++) mountNested(card,nested[nx]);

  /* header / footer slots inherited from the deck */
  mountHeaderFooter(card);
}

function prepFigure(fig){
  if(fig.classList.contains('embed')) return;
  var img=fig.querySelector('img');
  if(img){
    img.setAttribute('loading','lazy');
    img.addEventListener('error',function(){ placeholder(fig); });
    if(img.complete&&img.naturalWidth===0) placeholder(fig);
    return;
  }
  if(!fig.querySelector('.ld-ph')) placeholder(fig);
}
function placeholder(fig){
  if(fig.querySelector('.ld-ph')) return;
  var img=fig.querySelector('img');
  if(img) img.remove();
  var box=doc.createElement('div');
  box.className='ld-ph';
  box.appendChild(iconSvg(fig.getAttribute('data-icon')||'layers'));
  var kw=fig.getAttribute('data-placeholder')||fig.getAttribute('data-alt')||'';
  if(kw) box.setAttribute('title',kw);
  fig.insertBefore(box,fig.firstChild);
}

/* ---------------------------------------------------------------- charts */
function svgEl(name,attrs){
  var el=doc.createElementNS('http://www.w3.org/2000/svg',name);
  for(var k in attrs){ if(Object.prototype.hasOwnProperty.call(attrs,k)) el.setAttribute(k,String(attrs[k])); }
  return el;
}
function num(s){
  var v=parseFloat(String(s).replace(/[^0-9.\\-]/g,''));
  return isNaN(v)?0:v;
}
function readTable(tb){
  var head=[],rows=[];
  var ths=tb.querySelectorAll('thead th');
  for(var i=0;i<ths.length;i++) head.push((ths[i].textContent||'').trim());
  var trs=tb.querySelectorAll('tbody tr');
  if(!trs.length) trs=tb.querySelectorAll('tr');
  for(var r=0;r<trs.length;r++){
    var cells=trs[r].children;
    if(!cells.length) continue;
    if(!ths.length&&r===0){
      for(var h=0;h<cells.length;h++) head.push((cells[h].textContent||'').trim());
      continue;
    }
    var row={label:(cells[0].textContent||'').trim(),values:[]};
    for(var c=1;c<cells.length;c++) row.values.push(num(cells[c].textContent));
    rows.push(row);
  }
  return {head:head,rows:rows};
}
function palette(){
  var a=cssVar('--accent')||'#2563eb', b=cssVar('--accent-2')||'#0ea5e9', ink=cssVar('--ink')||'#0f172a';
  return [a,b,ink,a,b,ink];
}
function opacityFor(i){ return i<3?1:(i<6?0.55:0.35); }

function drawChart(tb){
  if(tb.classList.contains('chart-src')) return;
  var kind=(tb.getAttribute('data-chart')||'bar').toLowerCase();
  var data=readTable(tb);
  if(!data.rows.length) return;
  var wrap=doc.createElement('div');
  var svg=svgEl('svg',{viewBox:'0 0 820 430','class':'ld-chart',preserveAspectRatio:'xMidYMid meet',role:'img'});
  var cols=palette();
  var seriesNames=data.head.slice(1);
  var W=820,H=430,L=64,R=18,T=18,B=52;
  var iw=W-L-R, ih=H-T-B;

  function axes(maxV,minV){
    var g=svgEl('g',{});
    var ticks=4;
    for(var i=0;i<=ticks;i++){
      var y=T+ih-(ih*i/ticks);
      var line=svgEl('line',{x1:L,x2:W-R,y1:y,y2:y,'class':'ld-axis'});
      if(i>0) line.setAttribute('stroke-dasharray','3 5');
      g.appendChild(line);
      var lbl=svgEl('text',{x:L-10,y:y+4,'text-anchor':'end'});
      lbl.textContent=String(Math.round((minV+(maxV-minV)*i/ticks)*10)/10);
      g.appendChild(lbl);
    }
    return g;
  }
  function xLabels(){
    var g=svgEl('g',{});
    var step=iw/data.rows.length;
    for(var i=0;i<data.rows.length;i++){
      var tx=svgEl('text',{x:L+step*i+step/2,y:H-B+22,'text-anchor':'middle'});
      tx.textContent=data.rows[i].label;
      g.appendChild(tx);
    }
    return g;
  }
  function maxOf(stack){
    var mx=0;
    for(var i=0;i<data.rows.length;i++){
      var vs=data.rows[i].values;
      if(stack){ var s=0; for(var j=0;j<vs.length;j++) s+=vs[j]; if(s>mx) mx=s; }
      else { for(var k=0;k<vs.length;k++) if(vs[k]>mx) mx=vs[k]; }
    }
    return mx||1;
  }

  if(kind==='bar'||kind==='column'||kind==='stacked'){
    var stacked=(kind==='stacked');
    var mx=maxOf(stacked);
    svg.appendChild(axes(mx,0));
    var step=iw/data.rows.length, sn=Math.max(1,seriesNames.length||1);
    for(var i=0;i<data.rows.length;i++){
      var vs=data.rows[i].values, acc=0;
      for(var j=0;j<vs.length;j++){
        var h=ih*(vs[j]/mx);
        var bw=stacked?step*0.52:(step*0.68)/sn;
        var x=stacked?(L+step*i+step*0.24):(L+step*i+step*0.16+bw*j);
        var y=stacked?(T+ih-h-acc):(T+ih-h);
        svg.appendChild(svgEl('rect',{x:x,y:y,width:Math.max(1,bw-2),height:Math.max(0,h),rx:4,fill:cols[j%cols.length],'fill-opacity':opacityFor(j)}));
        acc+=stacked?h:0;
      }
    }
    svg.appendChild(xLabels());
  } else if(kind==='hbar'){
    var mxh=maxOf(false);
    var rh=ih/data.rows.length;
    for(var i2=0;i2<data.rows.length;i2++){
      var v=data.rows[i2].values[0]||0;
      var w=iw*(v/mxh);
      svg.appendChild(svgEl('rect',{x:L,y:T+rh*i2+rh*0.22,width:Math.max(1,w),height:rh*0.56,rx:5,fill:cols[0]}));
      var lt=svgEl('text',{x:L-10,y:T+rh*i2+rh*0.62,'text-anchor':'end'});
      lt.textContent=data.rows[i2].label;
      svg.appendChild(lt);
      var vt=svgEl('text',{x:L+w+8,y:T+rh*i2+rh*0.62});
      vt.textContent=String(v);
      svg.appendChild(vt);
    }
  } else if(kind==='line'||kind==='area'){
    var mxl=maxOf(false);
    svg.appendChild(axes(mxl,0));
    var stepL=data.rows.length>1?iw/(data.rows.length-1):iw;
    var sc=Math.max(1,seriesNames.length||1);
    for(var s2=0;s2<sc;s2++){
      var d='',da='';
      for(var p=0;p<data.rows.length;p++){
        var val=data.rows[p].values[s2]||0;
        var px=L+stepL*p, py=T+ih-ih*(val/mxl);
        d+=(p?' L':'M')+px.toFixed(1)+' '+py.toFixed(1);
      }
      if(kind==='area'){
        da=d+' L'+(L+stepL*(data.rows.length-1)).toFixed(1)+' '+(T+ih)+' L'+L+' '+(T+ih)+' Z';
        svg.appendChild(svgEl('path',{d:da,fill:cols[s2%cols.length],'fill-opacity':0.18}));
      }
      svg.appendChild(svgEl('path',{d:d,fill:'none',stroke:cols[s2%cols.length],'stroke-width':3.2,'stroke-linecap':'round','stroke-linejoin':'round'}));
      for(var p2=0;p2<data.rows.length;p2++){
        var val2=data.rows[p2].values[s2]||0;
        svg.appendChild(svgEl('circle',{cx:L+stepL*p2,cy:T+ih-ih*(val2/mxl),r:4.5,fill:cols[s2%cols.length]}));
      }
    }
    svg.appendChild(xLabels());
  } else if(kind==='scatter'){
    var mxx=0,mxy=0;
    for(var q=0;q<data.rows.length;q++){
      if((data.rows[q].values[0]||0)>mxx) mxx=data.rows[q].values[0];
      if((data.rows[q].values[1]||0)>mxy) mxy=data.rows[q].values[1];
    }
    mxx=mxx||1; mxy=mxy||1;
    svg.appendChild(axes(mxy,0));
    for(var q2=0;q2<data.rows.length;q2++){
      var vx=data.rows[q2].values[0]||0, vy=data.rows[q2].values[1]||0;
      svg.appendChild(svgEl('circle',{cx:L+iw*(vx/mxx),cy:T+ih-ih*(vy/mxy),r:8,fill:cols[0],'fill-opacity':.75}));
    }
  } else if(kind==='pie'||kind==='donut'){
    var total=0;
    for(var pz=0;pz<data.rows.length;pz++) total+=data.rows[pz].values[0]||0;
    total=total||1;
    var cx=W/2, cy=H/2-6, rad=Math.min(iw,ih)/2-6, inner=(kind==='donut')?rad*0.58:0, ang=-Math.PI/2;
    for(var pp=0;pp<data.rows.length;pp++){
      var frac=(data.rows[pp].values[0]||0)/total, a2=ang+frac*Math.PI*2, large=frac>0.5?1:0;
      var x1=cx+rad*Math.cos(ang), y1=cy+rad*Math.sin(ang), x2=cx+rad*Math.cos(a2), y2=cy+rad*Math.sin(a2);
      var dd='M'+x1.toFixed(1)+' '+y1.toFixed(1)+' A'+rad+' '+rad+' 0 '+large+' 1 '+x2.toFixed(1)+' '+y2.toFixed(1);
      if(inner){
        var ix2=cx+inner*Math.cos(a2), iy2=cy+inner*Math.sin(a2), ix1=cx+inner*Math.cos(ang), iy1=cy+inner*Math.sin(ang);
        dd+=' L'+ix2.toFixed(1)+' '+iy2.toFixed(1)+' A'+inner+' '+inner+' 0 '+large+' 0 '+ix1.toFixed(1)+' '+iy1.toFixed(1)+' Z';
      } else {
        dd+=' L'+cx+' '+cy+' Z';
      }
      svg.appendChild(svgEl('path',{d:dd,fill:cols[pp%cols.length],'fill-opacity':opacityFor(pp),stroke:cssVar('--surface')||'#fff','stroke-width':2}));
      var mid=ang+frac*Math.PI, lr=inner?(rad+inner)/2:rad*0.66;
      if(frac>0.05){
        var pt=svgEl('text',{x:cx+lr*Math.cos(mid),y:cy+lr*Math.sin(mid)+5,'text-anchor':'middle',fill:'#fff'});
        pt.setAttribute('style','font-weight:700');
        pt.textContent=Math.round(frac*100)+'%';
        svg.appendChild(pt);
      }
      ang=a2;
    }
  } else if(kind==='radar'){
    var axesN=data.rows.length, cxr=W/2, cyr=H/2-4, rr=Math.min(iw,ih)/2-14, mxr=maxOf(false);
    for(var ring=1;ring<=4;ring++){
      var pts='';
      for(var ax2=0;ax2<axesN;ax2++){
        var aa=-Math.PI/2+ax2*2*Math.PI/axesN, rrr=rr*ring/4;
        pts+=(cxr+rrr*Math.cos(aa)).toFixed(1)+','+(cyr+rrr*Math.sin(aa)).toFixed(1)+' ';
      }
      svg.appendChild(svgEl('polygon',{points:pts,fill:'none','class':'ld-axis'}));
    }
    var sc2=Math.max(1,seriesNames.length||1);
    for(var sr=0;sr<sc2;sr++){
      var pl='';
      for(var ax3=0;ax3<axesN;ax3++){
        var a3=-Math.PI/2+ax3*2*Math.PI/axesN, v3=(data.rows[ax3].values[sr]||0)/mxr*rr;
        pl+=(cxr+v3*Math.cos(a3)).toFixed(1)+','+(cyr+v3*Math.sin(a3)).toFixed(1)+' ';
      }
      svg.appendChild(svgEl('polygon',{points:pl,fill:cols[sr%cols.length],'fill-opacity':0.22,stroke:cols[sr%cols.length],'stroke-width':2.6}));
    }
    for(var lb=0;lb<axesN;lb++){
      var al=-Math.PI/2+lb*2*Math.PI/axesN;
      var tl=svgEl('text',{x:cxr+(rr+22)*Math.cos(al),y:cyr+(rr+22)*Math.sin(al)+4,'text-anchor':'middle'});
      tl.textContent=data.rows[lb].label;
      svg.appendChild(tl);
    }
  } else if(kind==='gauge'){
    var gv=data.rows[0].values[0]||0, gmax=data.rows[0].values[1]||100;
    var gcx=W/2, gcy=H*0.72, gr=Math.min(iw,ih*1.6)/2-20;
    function arcPath(frac,radius){
      var a0=Math.PI, a1=Math.PI+frac*Math.PI;
      return 'M'+(gcx+radius*Math.cos(a0)).toFixed(1)+' '+(gcy+radius*Math.sin(a0)).toFixed(1)+
        ' A'+radius+' '+radius+' 0 '+(frac>0.5?1:0)+' 1 '+(gcx+radius*Math.cos(a1)).toFixed(1)+' '+(gcy+radius*Math.sin(a1)).toFixed(1);
    }
    svg.appendChild(svgEl('path',{d:arcPath(1,gr),fill:'none',stroke:cols[2],'stroke-opacity':.14,'stroke-width':34,'stroke-linecap':'round'}));
    svg.appendChild(svgEl('path',{d:arcPath(Math.min(1,gv/(gmax||1)),gr),fill:'none',stroke:cols[0],'stroke-width':34,'stroke-linecap':'round'}));
    var gt=svgEl('text',{x:gcx,y:gcy-6,'text-anchor':'middle'});
    gt.setAttribute('style','font-size:58px;font-weight:800;fill:'+(cssVar('--ink')||'#0f172a'));
    gt.textContent=String(gv);
    svg.appendChild(gt);
    var gl=svgEl('text',{x:gcx,y:gcy+28,'text-anchor':'middle'});
    gl.textContent=data.rows[0].label||'';
    svg.appendChild(gl);
  } else if(kind==='waterfall'){
    var run=0,lo=0,hi=0,vals=[];
    for(var w1=0;w1<data.rows.length;w1++){
      var dv=data.rows[w1].values[0]||0;
      vals.push({from:run,to:run+dv,v:dv});
      run+=dv;
      if(run>hi) hi=run;
      if(run<lo) lo=run;
    }
    var span=(hi-lo)||1;
    svg.appendChild(axes(hi,lo));
    var stepW=iw/vals.length;
    for(var w2=0;w2<vals.length;w2++){
      var yTop=T+ih-ih*((Math.max(vals[w2].from,vals[w2].to)-lo)/span);
      var hgt=Math.abs(ih*(vals[w2].v/span));
      svg.appendChild(svgEl('rect',{x:L+stepW*w2+stepW*0.2,y:yTop,width:stepW*0.6,height:Math.max(2,hgt),rx:3,fill:vals[w2].v>=0?cols[0]:cols[1],'fill-opacity':.9}));
    }
    svg.appendChild(xLabels());
  } else {
    return;
  }

  wrap.appendChild(svg);
  if(seriesNames.length>1&&kind!=='pie'&&kind!=='donut'&&kind!=='gauge'){
    var leg=doc.createElement('div');
    leg.className='ld-legend';
    for(var lg=0;lg<seriesNames.length;lg++){
      var sp=doc.createElement('span');
      var sw=doc.createElement('i');
      sw.style.background=cols[lg%cols.length];
      sp.appendChild(sw);
      sp.appendChild(doc.createTextNode(seriesNames[lg]));
      leg.appendChild(sp);
    }
    wrap.appendChild(leg);
  }
  tb.parentNode.insertBefore(wrap,tb);
  tb.classList.add('chart-src');
}

/* ------------------------------------------------------------ code, embed */
var KEYWORDS={
  js:'const let var function return if else for while class new await async import export from default try catch throw typeof of in this null undefined true false',
  ts:'const let var function return if else for while class new await async import export from default try catch throw typeof of in this null undefined true false interface type enum public private readonly extends implements',
  py:'def class return if elif else for while import from as with try except raise lambda None True False and or not in is pass yield async await self',
  go:'func package import return if else for range var const type struct interface go defer chan map nil true false switch case',
  rust:'fn let mut pub use struct enum impl trait match if else for while return const static crate mod Some None Ok Err self',
  java:'public private protected class interface extends implements return if else for while new import package static final void int String boolean true false null this',
  sql:'select from where group by order having join left right inner outer on as insert into values update set delete create table alter drop and or not null limit',
  bash:'if then else fi for do done while case esac function return export local echo cd set source',
  css:'',json:'',yaml:'',html:''
};
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function highlight(code){
  if(code.getAttribute('data-hl')) return;
  code.setAttribute('data-hl','1');
  var cls=code.className||'';
  var m=/language-([a-z0-9+#]+)/i.exec(cls);
  var lang=(m?m[1]:'js').toLowerCase();
  if(lang==='javascript') lang='js';
  if(lang==='typescript') lang='ts';
  if(lang==='python') lang='py';
  if(lang==='shell'||lang==='sh') lang='bash';
  var kw=KEYWORDS[lang];
  if(kw===undefined) kw=KEYWORDS.js;
  var kws=kw?kw.split(' '):[];
  var src=code.textContent||'';
  var out=esc(src);
  out=out.replace(/(&quot;|&#39;|"|'|\`)(?:\\\\.|(?!\\1)[^\\\\\\n])*\\1/g,function(x){ return '<span class="tok-s">'+x+'</span>'; });
  out=out.replace(/(^|[^:])(\\/\\/[^\\n]*)/g,function(x,a,b){ return a+'<span class="tok-c">'+b+'</span>'; });
  out=out.replace(/(#[^\\n]*)/g,function(x){ return (lang==='py'||lang==='bash'||lang==='yaml')?'<span class="tok-c">'+x+'</span>':x; });
  out=out.replace(/\\b(\\d+(?:\\.\\d+)?)\\b/g,'<span class="tok-n">$1</span>');
  if(kws.length){
    var re=new RegExp('\\\\b('+kws.join('|')+')\\\\b','g');
    out=out.replace(re,'<span class="tok-k">$1</span>');
  }
  code.innerHTML=out;
}
function mountEmbed(fig){
  var src=fig.getAttribute('data-src')||'';
  var url=null;
  var yt=/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/)|youtu\\.be\\/)([\\w-]{6,})/.exec(src);
  var lo=/loom\\.com\\/(?:share|embed)\\/([\\w-]+)/.exec(src);
  var vm=/vimeo\\.com\\/(?:video\\/)?(\\d+)/.exec(src);
  var fg=/figma\\.com\\/(file|design|proto)\\//.test(src);
  var cp=/codepen\\.io\\/([^\\/]+)\\/(?:pen|details)\\/([\\w-]+)/.exec(src);
  if(yt) url='https://www.youtube.com/embed/'+yt[1];
  else if(lo) url='https://www.loom.com/embed/'+lo[1];
  else if(vm) url='https://player.vimeo.com/video/'+vm[1];
  else if(fg) url='https://www.figma.com/embed?embed_host=liberde&url='+encodeURIComponent(src);
  else if(cp) url='https://codepen.io/'+cp[1]+'/embed/'+cp[2];
  if(url){
    var fr=doc.createElement('iframe');
    fr.setAttribute('src',url);
    fr.setAttribute('allow','fullscreen; picture-in-picture');
    fr.setAttribute('allowfullscreen','');
    fr.setAttribute('loading','lazy');
    fig.appendChild(fr);
  } else {
    var card=doc.createElement('div');
    card.className='ld-linkcard';
    card.appendChild(iconSvg('globe'));
    var a=doc.createElement('a');
    a.setAttribute('href',src);
    a.setAttribute('target','_blank');
    a.setAttribute('rel','noopener');
    a.textContent=src.replace(/^https?:\\/\\//,'').slice(0,60);
    card.appendChild(a);
    fig.appendChild(card);
  }
}
function mountNested(parent,nested){
  if(nested.getAttribute('data-mounted')) return;
  nested.setAttribute('data-mounted','1');
  nested.classList.add('card');
  var pill=doc.createElement('button');
  pill.className='ld-nest-pill';
  pill.setAttribute('type','button');
  pill.appendChild(iconSvg('plus'));
  pill.appendChild(doc.createTextNode(nested.getAttribute('data-label')||'More detail'));
  parent.insertBefore(pill,nested);
  pill.addEventListener('click',function(){ nested.classList.toggle('open'); });
  nested.setAttribute('data-pill','1');
}
function mountHeaderFooter(card){
  var slots=['tl','tr','tc','bl','br','bc'];
  for(var i=0;i<slots.length;i++){
    var raw=deck.getAttribute('data-hf-'+slots[i]);
    if(!raw) continue;
    var n=parseInt(card.getAttribute('data-n')||'1',10);
    if(deck.hasAttribute('data-hf-hide-first')&&n===1) continue;
    if(deck.hasAttribute('data-hf-hide-last')&&n===cards.length) continue;
    if(card.querySelector('.ld-hf[data-pos="'+slots[i]+'"]')) continue;
    var box=doc.createElement('div');
    box.className='ld-hf';
    box.setAttribute('data-pos',slots[i]);
    if(raw==='cardNumber'){
      box.textContent=n+' / '+cards.length;
    } else if(raw.indexOf('logo:')===0){
      var im=doc.createElement('img');
      im.setAttribute('src',raw.slice(5));
      im.setAttribute('alt','');
      box.appendChild(im);
    } else {
      box.textContent=raw.replace(/^text:/,'');
    }
    card.appendChild(box);
  }
}

for(var ci=0;ci<cards.length;ci++) normalise(cards[ci]);

/* ------------------------------------------------------------- nav / toc */
var fmt=deck.getAttribute('data-format');
if(fmt==='webpage'){
  var nav=doc.createElement('nav');
  nav.id='ld-nav';
  var brand=doc.createElement('a');
  brand.className='ld-brand';
  brand.setAttribute('href','#card-1');
  var h1=cards[0].querySelector('h1,h2');
  brand.textContent=h1?(h1.textContent||'').trim().slice(0,38):'Home';
  nav.appendChild(brand);
  for(var nv=1;nv<cards.length;nv++){
    var hh=cards[nv].querySelector('h1,h2');
    if(!hh) continue;
    var a2=doc.createElement('a');
    a2.setAttribute('href','#'+cards[nv].id);
    a2.textContent=(hh.textContent||'').trim().slice(0,28);
    nav.appendChild(a2);
  }
  doc.body.insertBefore(nav,root);
} else if(fmt==='document'&&cards.length>3){
  var toc=doc.createElement('div');
  toc.id='ld-toc';
  var h4=doc.createElement('h4');
  h4.textContent='Contents';
  toc.appendChild(h4);
  var ol=doc.createElement('ol');
  for(var tc=0;tc<cards.length;tc++){
    var th2=cards[tc].querySelector('h1,h2');
    if(!th2) continue;
    var liq=doc.createElement('li');
    var aq=doc.createElement('a');
    aq.setAttribute('href','#'+cards[tc].id);
    aq.textContent=(th2.textContent||'').trim();
    liq.appendChild(aq);
    ol.appendChild(liq);
  }
  toc.appendChild(ol);
  doc.body.insertBefore(toc,root);
}

/* ----------------------------------------------------------------- views */
var i=0, spot=false, view='scroll';
var elCount=doc.getElementById('ld-count');
var elProg=doc.getElementById('ld-progress');
var elNotes=doc.getElementById('ld-notes');
var elNotesText=doc.getElementById('ld-notes-text');
var elNotesN=doc.getElementById('ld-notes-n');
var elToast=doc.getElementById('ld-toast');

function toast(msg){
  if(!elToast) return;
  elToast.textContent=msg;
  elToast.classList.add('on');
  setTimeout(function(){ elToast.classList.remove('on'); },1600);
}
function setCount(){
  if(elCount) elCount.textContent=(i+1)+' / '+cards.length;
  if(elProg) elProg.style.width=(((i+1)/cards.length)*100)+'%';
}
function show(n,noScroll){
  pushSave();
  i=Math.max(0,Math.min(cards.length-1,n));
  for(var c=0;c<cards.length;c++){
    cards[c].classList.toggle('active',c===i);
    if(c!==i){ cards[c].classList.remove('spot'); clearLit(cards[c]); }
  }
  if(view==='scroll'&&!noScroll) cards[i].scrollIntoView({behavior:'smooth',block:'start'});
  if(spot) applySpot();
  setCount();
  loadNotes();
  broadcast();
  beacon();
}
function takeFocus(){
  try{
    doc.body.setAttribute('tabindex','-1');
    window.focus();
    doc.body.focus({preventScroll:true});
  }catch(e){}
}
function blocks(card){
  var out=[],kids=card.children;
  for(var k=0;k<kids.length;k++){
    var el=kids[k];
    if(el.tagName==='ASIDE') continue;
    if(el.classList&&(el.classList.contains('ld-hf')||el.classList.contains('ld-bg'))) continue;
    if(el.tagName==='FIGURE'&&card.getAttribute('data-layout')==='image-bg') continue;
    out.push(el);
  }
  return out;
}
function clearLit(card){
  var b=blocks(card);
  for(var k=0;k<b.length;k++) b[k].classList.remove('lit');
}
var litN=0;
function applySpot(){
  var card=cards[i];
  card.classList.toggle('spot',spot);
  var b=blocks(card);
  for(var k=0;k<b.length;k++) b[k].classList.toggle('lit',!spot||k<litN);
}
function setView(v){
  view=v;
  doc.body.setAttribute('data-view',v);
  if(v==='present'||v==='presenter'){
    show(i,true);
    /* Presenting means the keyboard belongs to the deck. Without this the
       full-screen tab opens with focus still on the parent document and the
       first arrow key does nothing, which reads as a broken deck. Deliberately
       NOT done in scroll view: the inline preview must never steal focus from
       the chat composer while someone is typing. */
    takeFocus();
  } else {
    for(var c=0;c<cards.length;c++){ cards[c].classList.remove('active','spot'); clearLit(cards[c]); }
    spot=false;
    setCount();
  }
  var pb=doc.getElementById('ld-present');
  if(pb) pb.setAttribute('aria-pressed',String(v!=='scroll'));
}

/* ----------------------------------------------------------------- notes */
function noteText(n){
  var a=cards[n].querySelector('aside.notes,.notes');
  return a?(a.textContent||'').trim():'';
}
function loadNotes(){
  if(!elNotes||!elNotes.classList.contains('open')) return;
  if(elNotesN) elNotesN.textContent=String(i+1);
  if(elNotesText) elNotesText.value=noteText(i);
}
var dirty=false;
function pushSave(){
  if(!dirty) return;
  dirty=false;
  try{ parent.postMessage({__ld:'notesSaved',content:SRC},'*'); }catch(e){}
}
/* Notes and quick edits are written into the pristine source, never the live
   DOM, so a save can never carry runtime-injected SVG or wrappers back into
   the artifact the model will read next turn. */
function writeSource(mutate){
  try{
    var p=new DOMParser().parseFromString('<body>'+SRC+'</body>','text/html');
    var d=p.querySelector('.deck')||p.body;
    var list=[],kids=d.children;
    for(var k=0;k<kids.length;k++){
      var el=kids[k];
      if(el.tagName==='STYLE'||el.tagName==='SCRIPT') continue;
      if(el.hasAttribute('data-nested')) continue;
      if(el.tagName==='SECTION'||(el.classList&&el.classList.contains('card'))) list.push(el);
    }
    mutate(d,list,p);
    SRC=(p.querySelector('.deck')||p.body).outerHTML;
    if(!p.querySelector('.deck')) SRC=p.body.innerHTML;
    dirty=true;
  }catch(e){}
}
if(elNotesText){
  elNotesText.addEventListener('input',function(){
    var v=elNotesText.value, at=i;
    writeSource(function(d,list,p){
      if(!list[at]) return;
      var a=list[at].querySelector('aside.notes,.notes');
      if(v.trim()===''){ if(a) a.remove(); return; }
      if(!a){ a=p.createElement('aside'); a.className='notes'; list[at].appendChild(a); }
      a.textContent=v;
    });
    var live=cards[at].querySelector('aside.notes,.notes');
    if(v.trim()===''){ if(live) live.remove(); }
    else { if(!live){ live=doc.createElement('aside'); live.className='notes'; cards[at].appendChild(live); } live.textContent=v; }
    broadcast();
  });
  elNotesText.addEventListener('change',pushSave);
  elNotesText.addEventListener('blur',pushSave);
  elNotesText.addEventListener('keydown',function(e){ e.stopPropagation(); });
}
function toggleNotes(){
  if(!elNotes) return;
  var open=elNotes.classList.toggle('open');
  if(!open) pushSave();
  loadNotes();
  if(open&&elNotesText) elNotesText.focus();
  var nb=doc.getElementById('ld-notesbtn');
  if(nb) nb.setAttribute('aria-pressed',String(open));
}

/* ------------------------------------------------------------ quick edit */
var editing=false;
function toggleEdit(){
  var card=cards[i];
  editing=!editing;
  card.classList.toggle('qedit',editing);
  var b=blocks(card);
  for(var k=0;k<b.length;k++){
    if(editing) b[k].setAttribute('contenteditable','true');
    else b[k].removeAttribute('contenteditable');
  }
  if(editing){ toast('Quick edit on — press E again to save'); }
  else {
    var at=i, html='';
    var clone=card.cloneNode(true);
    var junk=clone.querySelectorAll('.ld-ico,.ld-ph,.ld-chart,.ld-legend,.ld-vs,.ld-hf,.ld-nest-pill');
    for(var j=0;j<junk.length;j++) junk[j].remove();
    var srcTables=clone.querySelectorAll('table.chart-src');
    for(var s=0;s<srcTables.length;s++) srcTables[s].classList.remove('chart-src');
    var unwrap=clone.querySelectorAll('.ld-cols,.ld-stats,.ld-gal');
    for(var u=0;u<unwrap.length;u++){
      var w=unwrap[u];
      while(w.firstChild) w.parentNode.insertBefore(w.firstChild,w);
      w.remove();
    }
    clone.classList.remove('active','spot','qedit');
    clone.removeAttribute('data-n');
    html=clone.innerHTML;
    writeSource(function(d,list){ if(list[at]) list[at].innerHTML=html; });
    pushSave();
    toast('Saved');
  }
}

/* ------------------------------------------------------- presenter view */
var chan=null;
try{ chan=new BroadcastChannel('ld-deck'); }catch(e){ chan=null; }
var isPresenter=(START==='presenter');
function broadcast(){
  if(!chan||isPresenter) return;
  try{ chan.postMessage({t:'pos',i:i,n:cards.length,note:noteText(i),title:cardTitle(i),next:cardTitle(i+1)}); }catch(e){}
}
function cardTitle(n){
  if(n<0||n>=cards.length) return '';
  var h=cards[n].querySelector('h1,h2,h3');
  return h?(h.textContent||'').trim():('Card '+(n+1));
}
if(chan){
  chan.onmessage=function(ev){
    var m=ev.data||{};
    if(isPresenter&&m.t==='pos'){ renderPresenter(m); }
    else if(!isPresenter&&m.t==='goto'){ show(m.i,true); }
  };
}
function renderPresenter(m){
  var st=doc.getElementById('ld-pv-stage'), nx=doc.getElementById('ld-pv-next'), nt=doc.getElementById('ld-pv-notes');
  if(st) st.setAttribute('data-title',m.title||'');
  if(st){ var h=st.querySelector('.ld-pv-t'); if(!h){ h=doc.createElement('div'); h.className='ld-pv-t'; h.style.cssText='font:700 28px/1.2 ui-sans-serif;padding:20px;text-align:center'; st.appendChild(h);} h.textContent=m.title||''; }
  if(nx){ var h2b=nx.querySelector('.ld-pv-t'); if(!h2b){ h2b=doc.createElement('div'); h2b.className='ld-pv-t'; h2b.style.cssText='font:600 18px/1.3 ui-sans-serif;padding:16px;text-align:center;opacity:.75'; nx.appendChild(h2b);} h2b.textContent=m.next||'End of deck'; }
  if(nt) nt.textContent=m.note||'No notes for this card.';
  var pc=doc.getElementById('ld-pv-count');
  if(pc) pc.textContent=(m.i+1)+' / '+m.n;
}
if(isPresenter){
  var t0=Date.now(), tick=doc.getElementById('ld-pv-timer');
  setInterval(function(){
    if(!tick) return;
    var s=Math.floor((Date.now()-t0)/1000);
    var mm=Math.floor(s/60), ss=s%60;
    tick.textContent=(mm<10?'0':'')+mm+':'+(ss<10?'0':'')+ss;
  },500);
  var rs=doc.getElementById('ld-pv-reset');
  if(rs) rs.addEventListener('click',function(){ t0=Date.now(); });
}

/* ------------------------------------------------------------- analytics */
/* Published decks report how long each card was actually on screen, so the
   owner can see where attention went. Anonymous: the id below is invented here
   and never leaves this page's session, and nothing else is sent. Only the
   hosted /live path sets LD_BEACON — the in-app preview and the downloaded
   file measure nothing. */
var beaconOn=(typeof LD_BEACON!=='undefined')&&LD_BEACON;
var viewId='';
try{
  viewId=String(Date.now())+'-'+Math.random().toString(36).slice(2,10);
}catch(e){}
var lastAt=Date.now(), lastCard=-1;
function beacon(){
  if(!beaconOn) return;
  var now=Date.now();
  if(lastCard>=0&&now-lastAt>250){
    try{
      var body=JSON.stringify({view:viewId,card:lastCard,ms:now-lastAt});
      /* text/plain keeps this a simple request: a JSON content type would need
         a CORS preflight, which an opaque-origin page cannot complete. */
      if(navigator.sendBeacon) navigator.sendBeacon(LD_BEACON,new Blob([body],{type:'text/plain'}));
    }catch(e){}
  }
  lastCard=i; lastAt=now;
}
if(beaconOn){
  window.addEventListener('pagehide',beacon);
  doc.addEventListener('visibilitychange',function(){ if(doc.visibilityState==='hidden') beacon(); });
  beacon();
}

/* ------------------------------------------------------------- controls */
function bind(id,fn){ var el=doc.getElementById(id); if(el) el.addEventListener('click',fn); }
bind('ld-prev',function(){ step(-1); });
bind('ld-next',function(){ step(1); });
bind('ld-notesbtn',toggleNotes);
bind('ld-print',function(){ window.print(); });
bind('ld-spot',function(){ spot=!spot; litN=spot?1:0; applySpot(); var b=doc.getElementById('ld-spot'); if(b) b.setAttribute('aria-pressed',String(spot)); });
bind('ld-present',function(){ setView(view==='scroll'?'present':'scroll'); });

function step(dir){
  if(view!=='scroll'&&spot&&dir>0){
    var b=blocks(cards[i]);
    if(litN<b.length){ litN++; applySpot(); return; }
  }
  if(view!=='scroll'&&spot&&dir<0&&litN>1){ litN--; applySpot(); return; }
  litN=spot?1:0;
  if(view==='scroll'){
    var next=Math.max(0,Math.min(cards.length-1,i+dir));
    show(next);
  } else {
    show(i+dir,true);
  }
}
doc.addEventListener('keydown',function(e){
  var tgt=e.target;
  if(tgt&&(tgt.isContentEditable||tgt.tagName==='TEXTAREA'||tgt.tagName==='INPUT')) return;
  var k=e.key;
  if(k==='ArrowRight'||k===' '||k==='PageDown'){ e.preventDefault(); step(1); }
  else if(k==='ArrowLeft'||k==='PageUp'){ e.preventDefault(); step(-1); }
  else if(k==='ArrowDown'&&view!=='scroll'){ e.preventDefault(); cards[i].scrollBy({top:120,behavior:'smooth'}); }
  else if(k==='ArrowUp'&&view!=='scroll'){ e.preventDefault(); cards[i].scrollBy({top:-120,behavior:'smooth'}); }
  else if(k==='Home'){ show(0); }
  else if(k==='End'){ show(cards.length-1); }
  else if(k==='n'||k==='N'){ toggleNotes(); }
  else if(k==='s'||k==='S'){ if(view!=='scroll'){ spot=!spot; litN=spot?1:0; applySpot(); } }
  else if(k==='e'||k==='E'){ toggleEdit(); }
  else if(k==='p'||k==='P'){ setView(view==='scroll'?'present':'scroll'); }
  else if(k==='Enter'){
    var nest=cards[i].querySelector('.card[data-nested]');
    if(nest){ nest.classList.toggle('open'); }
    else if(view==='scroll'){ setView('present'); }
  }
  else if(k==='Escape'){
    if(spot){ spot=false; applySpot(); }
    else if(view!=='scroll') setView('scroll');
  }
});
deck.addEventListener('click',function(e){
  if(view==='scroll'||editing) return;
  if(e.target.closest('a,button,input,textarea,select,video,audio,iframe,[contenteditable="true"]')) return;
  var x=e.clientX/window.innerWidth;
  if(x>0.68) step(1);
  else if(x<0.32) step(-1);
});
var tx=0,ty=0;
doc.addEventListener('touchstart',function(e){ if(!e.touches[0])return; tx=e.touches[0].clientX; ty=e.touches[0].clientY; },{passive:true});
doc.addEventListener('touchend',function(e){
  if(view==='scroll'||!e.changedTouches[0]) return;
  var dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5) step(dx<0?1:-1);
},{passive:true});

/* scroll view tracks which card you are looking at, for the counter */
if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(entries){
    if(view!=='scroll') return;
    for(var n=0;n<entries.length;n++){
      if(entries[n].isIntersecting){
        var idx=cards.indexOf(entries[n].target);
        if(idx>=0&&idx!==i){ i=idx; setCount(); broadcast(); beacon(); }
      }
    }
  },{threshold:0.55});
  for(var ob=0;ob<cards.length;ob++) io.observe(cards[ob]);
}

window.addEventListener('pagehide',pushSave);
doc.addEventListener('visibilitychange',function(){ if(doc.visibilityState==='hidden') pushSave(); });

/* --------------------------------------------------- host message bridge */
window.addEventListener('message',function(ev){
  var m=ev.data;
  if(!m||typeof m!=='object'||!m.__ld) return;
  if(m.__ld==='setAttr'&&m.attr){
    deck.setAttribute(m.attr,m.value);
    if(m.attr==='data-theme') applyTheme();
    var ch=deck.querySelectorAll('table[data-chart]');
    for(var q=0;q<ch.length;q++){
      var prev=ch[q].previousElementSibling;
      if(prev&&prev.querySelector&&prev.querySelector('.ld-chart')) prev.remove();
      ch[q].classList.remove('chart-src');
      drawChart(ch[q]);
    }
  } else if(m.__ld==='present'){
    setView(m.value||'present');
  } else if(m.__ld==='goto'){
    show(m.index||0);
  } else if(m.__ld==='spotlight'){
    spot=!!m.value; litN=spot?1:0; applySpot();
  }
});

setView(START);
setCount();
try{ parent.postMessage({__ld:'deckReady',cards:cards.length},'*'); }catch(e){}
})();
`;
