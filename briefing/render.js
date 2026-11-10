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

/* "+ Planner" buttons. A tap on any device (PC or phone) queues the task in a planner inbox kept
   in this artifact's private per-person store (the db capability, data/users/<you>/inbox), so
   the PC and the phone see the same inbox. On the phone, "Send to Kikker" opens the Kikker
   Assistant app with kikkerassistant://add?t=... and the tasks land in today's plan. */
const taskOf = (x) => String(x.action || x.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
const planBtn = (tasks, label, cls) => `<button type="button" class="plan${cls ? ' ' + cls : ''}" data-task="${esc(JSON.stringify(tasks))}">${label}</button>`;
const planTasks = (b.needs_you || []).map(taskOf).filter(Boolean);

const needs = (b.needs_you || []).map((x) => `
  <li class="item">
    <div class="top">${src(x.source)}${x.from ? `<span class="from">${esc(x.from)}</span>` : ''}${x.when ? `<span class="when">${esc(x.when)}</span>` : ''}</div>
    <b>${link(x.link, esc(x.title))}</b>
    ${x.why ? `<p>${esc(x.why)}</p>` : ''}
    <div class="actrow">${x.action ? `<p class="act">→ ${esc(x.action)}</p>` : '<span></span>'}${taskOf(x) ? planBtn([taskOf(x)], '+ Planner') : ''}</div>
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
.actrow{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;margin-top:4px}
.actrow .act{margin:0}
.plan{flex:none;font:700 13px var(--body);color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent);border-radius:999px;padding:5px 11px;white-space:nowrap;cursor:pointer}
.plan.all{display:inline-block;margin:0 0 10px;padding:8px 14px;font-size:14px}
.plan.in{color:var(--dim);background:none;border-color:var(--line)}
.inbox{position:sticky;top:0;z-index:5;margin:12px 0 0;padding:12px 14px;border-radius:14px;background:var(--card);border:1px solid var(--accent);box-shadow:0 4px 14px rgba(0,0,0,.12);display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between}
.inbox[hidden]{display:none}
.inbox b{display:block;font:600 19px/1.15 var(--display)}
.inbox small{display:block;font-size:13px;color:var(--dim)}
.inbox .acts{display:flex;gap:8px;flex-wrap:wrap}
.inbox a.go{background:var(--accent);color:#1a1206;border-radius:12px;padding:9px 14px;font-weight:700;text-decoration:none}
.inbox button.lite{font:700 13px var(--body);background:none;border:1px solid var(--line);color:var(--fg);border-radius:12px;padding:8px 12px;cursor:pointer}
</style>
<header><div class="wrap">${kikker}<div class="head"><div class="date">${esc(b.date_label)}</div><h1>${esc(b.headline)}</h1>${b.kikker_note ? `<p>${esc(b.kikker_note)}</p>` : ''}</div></div></header>
<main class="wrap">
  <div class="inbox" id="inbox" hidden aria-live="polite"></div>
  <h2>Needs you <small>${busy} item${busy === 1 ? '' : 's'}</small></h2>
  ${planTasks.length > 1 ? planBtn(planTasks, `+ Add all ${planTasks.length} to today’s planner`, 'all') : ''}
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
<script>
/* Planner inbox: "+ Planner" queues tasks in this page's private per-person store, shared by the
   PC and the phone. On Android, "Send to Kikker" opens the Kikker Assistant app with the tasks. */
(function () {
  var ANDROID = /Android/i.test(navigator.userAgent);
  var box = document.getElementById('inbox');
  var ref = null, tasks = [], sent = [], ready = false;
  function appLink(list) { return 'kikkerassistant://add?' + list.map(function (t) { return 't=' + encodeURIComponent(t); }).join('&'); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function has(t) { return tasks.some(function (x) { return x.text === t; }); }
  function marks() {
    document.querySelectorAll('button.plan').forEach(function (b) {
      var list = JSON.parse(b.dataset.task), all = list.every(has);
      if (!b.dataset.label) b.dataset.label = b.textContent;
      b.classList.toggle('in', all);
      b.textContent = all ? '✓ In planner inbox' : b.dataset.label;
    });
  }
  function draw() {
    marks();
    box.replaceChildren();
    if (!ready) { box.hidden = true; return; }
    var acts = el('div', 'acts'), txt = el('div');
    if (tasks.length) {
      var n = tasks.length, list = tasks.map(function (x) { return x.text; });
      txt.append(el('b', null, n + ' task' + (n === 1 ? '' : 's') + ' waiting for Kikker'));
      if (ANDROID) {
        txt.append(el('small', null, 'Tap send and they land in today’s plan.'));
        var go = el('a', 'go', 'Send to Kikker');
        go.href = appLink(list); go.target = '_blank'; go.rel = 'noopener';
        go.addEventListener('click', function () { setTimeout(function () { save([], list); }, 400); });
        acts.append(go);
      } else {
        txt.append(el('small', null, 'Open this briefing on your phone and tap “Send to Kikker”.'));
      }
      var copy = el('button', 'lite', 'Copy list');
      copy.addEventListener('click', function () {
        var s = list.join('\\n');
        (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(function () { copy.textContent = 'Copied'; }, function () { prompt('Copy these, then paste into Plan › Add several at once:', s); });
      });
      var clear = el('button', 'lite', 'Clear');
      clear.addEventListener('click', function () { save([], []); });
      acts.append(copy, clear);
    } else if (sent.length) {
      txt.append(el('b', null, 'Sent ' + sent.length + ' to Kikker'));
      txt.append(el('small', null, 'Not in the Kikker app? Put them back, then use Copy list and paste into Plan.'));
      var undo = el('button', 'lite', 'Put them back');
      undo.addEventListener('click', function () { save(sent.map(function (t) { return { text: t, at: Date.now() }; }), []); });
      acts.append(undo);
    } else { box.hidden = true; return; }
    box.append(txt, acts);
    box.hidden = false;
  }
  function save(nextTasks, nextSent) {
    tasks = nextTasks; sent = nextSent; draw();
    if (!ref) return Promise.resolve();
    return ref.set({ tasks: nextTasks, sent: nextSent, updated: Date.now() }).catch(function () {
      box.hidden = false; box.replaceChildren(el('small', null, 'Couldn’t save to your planner inbox. Try again in a moment.'));
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button.plan');
    if (!b) return;
    var list = JSON.parse(b.dataset.task);
    if (!ref) { // no inbox here: hand straight to the app on a phone
      if (ANDROID) { window.open(appLink(list), '_blank'); } else { b.textContent = 'Open on your phone to add'; }
      return;
    }
    var add = list.filter(function (t) { return !has(t); }).map(function (t) { return { text: t, at: Date.now() }; });
    if (add.length) save(tasks.concat(add), []);
  });
  if (!window.claude || !window.claude.use) return;
  Promise.all([window.claude.use('db'), window.claude.use('user')]).then(function (r) {
    var db = r[0], user = r[1];
    if (!db || !user) return null;
    return user.id().then(function (id) {
      if (!id) return;
      ref = db.doc('data/users/' + id + '/inbox');
      ref.onSnapshot(function (snap) {
        var d = snap.exists ? snap.data() : {};
        tasks = Array.isArray(d.tasks) ? d.tasks.filter(function (x) { return x && typeof x.text === 'string'; }) : [];
        sent = Array.isArray(d.sent) ? d.sent.filter(function (t) { return typeof t === 'string'; }) : [];
        ready = true; draw();
      }, function () { ref = null; ready = false; draw(); });
    });
  }).catch(function () {});
})();
</script>
`;
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${html.length} bytes)`);
