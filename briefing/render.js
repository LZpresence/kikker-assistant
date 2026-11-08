#!/usr/bin/env node
/* Renders a morning briefing (JSON) into the HTML page that gets published as a private
   claude.ai Artifact. Usage: node render.js <briefing.json> <out.html>
   The JSON shape is documented in ROUTINE.md. Kikker is drawn with ../kikker.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) { console.error('usage: node render.js <briefing.json> <out.html>'); process.exit(1); }
const b = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'kikker.js'), 'utf8') + '\nthis.kikkerSvg = kikkerSvg;', ctx);
const busy = (b.needs_you || []).length;
const kikker = ctx.kikkerSvg(new Set(['sleeves', 'pants']), { sunny: true, mood: busy > 4 ? 'meh' : 'happy' });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (url, text) => (url && /^https:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>` : text);
const src = (s) => (s ? `<span class="src">${esc(s)}</span>` : '');

const needs = (b.needs_you || []).map((x) => `
  <li class="item">
    <div class="top">${src(x.source)}${x.from ? `<span class="from">${esc(x.from)}</span>` : ''}${x.when ? `<span class="when">${esc(x.when)}</span>` : ''}</div>
    <b>${link(x.link, esc(x.title))}</b>
    ${x.why ? `<p>${esc(x.why)}</p>` : ''}
    ${x.action ? `<p class="act">→ ${esc(x.action)}</p>` : ''}
  </li>`).join('');

const today = (b.today || []).map((x) => `
  <li class="ev${x.flag ? ' flag' : ''}">
    <span class="time num">${esc(x.time)}</span>
    <div><b>${link(x.link, esc(x.title))}</b>${x.detail ? `<p>${esc(x.detail)}</p>` : ''}${x.flag ? `<p class="warn">${esc(x.flag)}</p>` : ''}</div>
  </li>`).join('');

const fyi = (b.fyi || []).map((x) => `
  <li class="item small"><div class="top">${src(x.source)}${x.from ? `<span class="from">${esc(x.from)}</span>` : ''}</div>
    <b>${link(x.link, esc(x.title))}</b>${x.detail ? `<p>${esc(x.detail)}</p>` : ''}</li>`).join('');

const sk = b.skipped || {};
const skippedTxt = Object.entries(sk).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ');
const notes = (b.source_notes || []).map((n) => `<li>${esc(n)}</li>`).join('');

const html = `<title>Kikker Briefing</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<style>
/* Layout: one reading column; sky header with Kikker and the headline, then Needs you / Today / FYI. */
:root{
  --sky:#1d3b57; --sky2:#2c5a80; --on-sky:#f3f7fb; --on-sky-dim:#b9cbdc;
  --bg:#eef2f5; --card:#ffffff; --fg:#14202b; --dim:#5b6b79; --line:#d8e0e7;
  --accent:#c96f12; --accent-soft:#fbe9d5; --warn:#b4471f;
  --display:"Barlow Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --sky:#0d1720; --sky2:#16283a; --on-sky:#eaf1f7; --on-sky-dim:#8fa6ba;
  --bg:#0a1219; --card:#121e29; --fg:#e4ebf1; --dim:#8c9dac; --line:#223241;
  --accent:#f0a24c; --accent-soft:#3a2a17; --warn:#f08a5a; color-scheme:dark}}
:root[data-theme="dark"]{
  --sky:#0d1720; --sky2:#16283a; --on-sky:#eaf1f7; --on-sky-dim:#8fa6ba;
  --bg:#0a1219; --card:#121e29; --fg:#e4ebf1; --dim:#8c9dac; --line:#223241;
  --accent:#f0a24c; --accent-soft:#3a2a17; --warn:#f08a5a; color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:16px/1.5 var(--body)}
.wrap{max-width:640px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
header{background:linear-gradient(180deg,var(--sky),var(--sky2));color:var(--on-sky)}
header .wrap{display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:center;padding-block:16px 20px}
header svg{width:96px;height:96px;display:block}
.date{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--on-sky-dim)}
h1{font:600 30px/1.05 var(--display);margin:2px 0 6px;text-wrap:balance}
.head p{margin:0;font-size:15px;color:var(--on-sky)}
main{padding-block:8px 40px}
h2{font:600 15px/1 var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:24px 0 10px;display:flex;justify-content:space-between;align-items:baseline}
h2 small{font:400 12px var(--body);letter-spacing:0;text-transform:none}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.item{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.needs .item{border-left:4px solid var(--accent)}
.item b{display:block;font-size:16px;line-height:1.3}
.item p{margin:4px 0 0;font-size:14px;color:var(--dim)}
.item p.act{color:var(--fg);font-weight:700}
.item.small b{font-size:15px}
.top{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12px;color:var(--dim);margin-bottom:4px}
.src{font-weight:700;color:var(--accent);background:var(--accent-soft);padding:1px 8px;border-radius:999px}
a{color:inherit;text-decoration-color:var(--line);text-underline-offset:3px}
a:hover{text-decoration-color:var(--accent)}
.today{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 14px;gap:0}
.ev{display:grid;grid-template-columns:84px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line)}
.ev:first-child{border-top:0}
.time{font:600 17px/1.3 var(--display);color:var(--dim)}
.num{font-variant-numeric:tabular-nums}
.ev b{font-size:15px}
.ev p{margin:2px 0 0;font-size:13px;color:var(--dim)}
.ev p.warn{color:var(--warn);font-weight:700}
.foot{font-size:12px;color:var(--dim);margin-top:24px}
.foot ul{gap:2px;list-style:disc;padding-left:18px}
.empty{color:var(--dim);font-size:14px}
</style>
<header><div class="wrap">${kikker}<div class="head"><div class="date">${esc(b.date_label)}</div><h1>${esc(b.headline)}</h1>${b.kikker_note ? `<p>${esc(b.kikker_note)}</p>` : ''}</div></div></header>
<main class="wrap">
  <h2>Needs you <small>${busy} item${busy === 1 ? '' : 's'}</small></h2>
  ${needs ? `<ul class="needs">${needs}</ul>` : '<p class="empty">Nothing waiting on you. Nice.</p>'}
  <h2>${esc(b.today_label || 'Today')}</h2>
  ${today ? `<ul class="today">${today}</ul>` : '<p class="empty">No meetings on the calendar.</p>'}
  <h2>FYI <small>can wait</small></h2>
  ${fyi ? `<ul>${fyi}</ul>` : '<p class="empty">Nothing else worth your time.</p>'}
  <div class="foot">
    <p>Read ${esc((b.sources || []).join(', '))} for ${esc(b.window || 'the last day')}.${skippedTxt ? ` Skipped ${esc(skippedTxt)}.` : ''} Generated ${esc(b.generated_label || '')} by your Kikker briefing routine. Read-only: nothing was sent or changed.</p>
    ${notes ? `<ul>${notes}</ul>` : ''}
  </div>
</main>
`;
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${html.length} bytes)`);
