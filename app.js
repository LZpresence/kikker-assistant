/* Kikker Assistant — keeps the day on track: morning activity, after-work responsibilities,
   a project hour, bedtime, and weekly goals. Everything is stored on this phone only.
   Weather for the morning pick: Open-Meteo (no key). Reminders: the Android app's native
   notifications, through window.KikkerApp. */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = (n) => String(n).padStart(2, '0');
const MIN = 60e3;
const KEY = 'ka.v1';
const app = () => (window.KikkerApp && typeof window.KikkerApp.setReminders === 'function' ? window.KikkerApp : null);

/* ---------- defaults (all editable in Settings) ---------- */
const item = (text) => ({ id: uid(), text });
function defaults() {
  const reflect = item('Quiet reflection: prayer, gratitude or journaling');
  return {
    v: 1,
    name: '',
    remindersOn: true,
    loc: null,
    weekday: { wakeEarliest: '05:00', wakeStart: '06:00', wakeEnd: '06:30', homeAt: '17:00', kidStart: '19:00', kidEnd: '20:00', projectAt: '20:05', windDown: '21:45', bed: '22:00', bedLatest: '22:30' },
    weekend: { wakeEarliest: '05:30', wakeStart: '07:00', wakeEnd: '08:00', homeAt: '10:00', kidStart: '19:00', kidEnd: '20:00', projectAt: '14:00', windDown: '22:15', bed: '22:30', bedLatest: '23:00' },
    lists: {
      morning: [item('Glass of water and a stretch')],
      home: [item('Check in with my daughter about her day'), item('Dinner'), item('Kitchen cleaned up'), item('Lunch and backpack ready for tomorrow')],
      weekendHome: [item('Tidy the kitchen'), item('Laundry'), item('Plan something fun with my daughter')],
      kid: [item('Bath and pajamas'), item('Brush teeth'), item('Story time'), item('Lights out by 8')],
      night: [item('Phone charging outside the bedroom'), item("Lay out tomorrow's clothes"), reflect],
    },
    goals: [
      { id: uid(), name: 'Morning exercise', pillar: 'Physical', target: 4, source: 'exercise' },
      { id: uid(), name: 'Project hour', pillar: 'Mental', target: 5, source: 'project' },
      { id: uid(), name: 'In bed on time', pillar: 'Mental', target: 5, source: 'bed' },
      { id: uid(), name: 'Evening routine done', pillar: 'Family & social', target: 5, source: 'home' },
      { id: uid(), name: 'Reach out to a friend', pillar: 'Family & social', target: 2, source: 'manual' },
      { id: uid(), name: 'Quiet reflection', pillar: 'Spiritual', target: 5, source: `item:${reflect.id}` },
    ],
    projects: [
      { id: uid(), name: 'Guitar build', steps: [{ id: uid(), text: 'Decide the next small step', done: false }], notes: [], last: 0, archived: false },
      { id: uid(), name: 'Guitar practice', steps: [{ id: uid(), text: '20 min scales, then a song', done: false }], notes: [], last: 0, archived: false },
      { id: uid(), name: 'Organize the shop', steps: [{ id: uid(), text: 'Clear one bench', done: false }], notes: [], last: 0, archived: false },
      { id: uid(), name: 'D&D session prep', steps: [{ id: uid(), text: 'Outline the next session', done: false }], notes: [], last: 0, archived: false },
    ],
    log: {},
    wx: null,
  };
}

/* Phase 2: the morning briefing is a private claude.ai page that a scheduled Claude routine
   refreshes on weekdays. Change the link in Settings when using another Claude account. */
const BRIEFING_DEFAULT = 'https://claude.ai/artifact/Hxr4SUGNBZVTyitSkArRPD';
function upgrade(s) {
  if (s.briefingUrl === undefined) s.briefingUrl = BRIEFING_DEFAULT;
  if (!s.briefingAt) s.briefingAt = '08:15';
  // Daily planner: the old "Plan the top 3" checklist item became the Plan tab.
  if (!s.plans) {
    s.plans = {};
    if (s.lists && s.lists.morning) s.lists.morning = s.lists.morning.filter((i) => !/^plan the top 3/i.test(i.text));
  }
  return s;
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return upgrade(s); } catch { /* fresh start */ }
  return upgrade(defaults());
}
let S = load();
function save(quiet) {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('Could not save on this device'); }
  if (!quiet) scheduleReminders();
}

/* ---------- time helpers ---------- */
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const prof = (d) => (isWeekend(d) ? S.weekend : S.weekday);
/* Evenings follow the next morning: Friday night is a weekend night, Sunday night is a school night. */
const nightProf = (d) => (d.getDay() === 5 ? S.weekend : d.getDay() === 0 ? S.weekday : prof(d));
const dayKind = (d) => (d.getDay() === 5 ? 'weekend night' : d.getDay() === 0 ? 'weekend · school night' : isWeekend(d) ? 'weekend' : '');
const at = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLog = (d) => { const k = ymd(d); return S.log[k] || (S.log[k] = { checks: {}, manual: {} }); };
const peekLog = (d) => S.log[ymd(d)] || { checks: {}, manual: {} };
const mondayOf = (d) => { const x = startOfDay(d); const off = (x.getDay() + 6) % 7; return addDays(x, -off); };

/* ---------- daily planner ---------- */
const TOP = 3;
const peekPlan = (d) => S.plans[ymd(d)] || [];
const planOf = (d) => { const k = ymd(d); return S.plans[k] || (S.plans[k] = []); };
/** Adds tasks to a day's plan, skipping ones already there. The first ones fill the top 3. */
function addTasks(texts, date, extra) {
  const plan = planOf(date);
  let n = 0;
  for (const raw of texts) {
    const text = String(raw || '').trim().slice(0, 200);
    if (!text || plan.some((t) => t.text.toLowerCase() === text.toLowerCase())) continue;
    plan.push({ id: uid(), text, done: false, top: plan.filter((t) => t.top && !t.done).length < TOP, ...(extra || {}) });
    n++;
  }
  return n;
}
/** Unfinished tasks from the most recent earlier day (looks back a week). */
function leftovers(date) {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i), left = peekPlan(d).filter((t) => !t.done && !t.moved);
    if (left.length) return { date: d, tasks: left };
  }
  return null;
}

/* ---------- weather (Open-Meteo, cached for an hour) ---------- */
async function loadWeather(force) {
  if (!S.loc) return null;
  if (!force && S.wx && Date.now() - S.wx.at < 60 * MIN && S.wx.key === `${S.loc.lat},${S.loc.lon}`) return S.wx.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${S.loc.lat.toFixed(4)}&longitude=${S.loc.lon.toFixed(4)}`
    + '&timezone=auto&timeformat=unixtime&forecast_days=8&temperature_unit=fahrenheit&wind_speed_unit=mph'
    + '&daily=sunrise,sunset&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    S.wx = { at: Date.now(), key: `${S.loc.lat},${S.loc.lon}`, data };
    save(true);
    return data;
  } catch { return S.wx ? S.wx.data : null; }
}

/* Which indoor option is due: whichever of karate / workout was done less recently. */
function indoorPick(date) {
  let lastK = -1, lastW = -1;
  for (let i = 1; i <= 21; i++) {
    const e = peekLog(addDays(date, -i)).exercise;
    if (e === 'karate' && lastK < 0) lastK = i;
    if (e === 'workout' && lastW < 0) lastW = i;
  }
  if (lastK < 0) return 'karate';
  if (lastW < 0) return 'workout';
  return lastK >= lastW ? 'karate' : 'workout';
}
const ACT = { bike: 'Bike ride', karate: 'Karate practice', workout: 'Home workout', rest: 'Rest day' };

/* Wake 10 minutes before sunrise when it's a biking morning and the sun is up by the end of the
   wake window; otherwise wake at the start of the window and do karate or a workout. */
function morningPlan(date) {
  const p = prof(date);
  const wakeStart = at(date, p.wakeStart), wakeEnd = at(date, p.wakeEnd), earliest = at(date, p.wakeEarliest);
  const indoor = indoorPick(date);
  const W = S.wx && S.wx.data;
  const plain = (why) => ({ wake: wakeStart, act: indoor, sunrise: null, why });
  if (!W) return plain(S.loc ? 'Weather is loading.' : 'Add your location in Settings so Kikker can check sunrise and weather.');
  const di = W.daily.time.findIndex((t) => ymd(new Date(t * 1000)) === ymd(date));
  if (di < 0) return plain('No forecast for this day yet.');
  const sunrise = new Date(W.daily.sunrise[di] * 1000);
  const from = sunrise.getTime(), to = from + 90 * MIN;
  const hs = [];
  W.hourly.time.forEach((t, i) => {
    const ms = t * 1000;
    if (ms >= from - 60 * MIN && ms <= to) {
      hs.push({ t: W.hourly.temperature_2m[i], f: W.hourly.apparent_temperature[i], pop: W.hourly.precipitation_probability[i] ?? 0,
        pr: W.hourly.precipitation[i] ?? 0, wind: W.hourly.wind_speed_10m[i] ?? 0, code: W.hourly.weather_code[i] ?? 0 });
    }
  });
  if (!hs.length) return plain('No forecast for this morning yet.');
  const feels = Math.min(...hs.map((h) => h.f)), pop = Math.max(...hs.map((h) => h.pop));
  const wet = hs.some((h) => h.pr > 0.01), wind = Math.max(...hs.map((h) => h.wind)), storm = hs.some((h) => h.code >= 95);
  const dry = pop < 30 && !wet && !storm;
  const temp = Math.round(hs[Math.min(1, hs.length - 1)].t);
  const sunInTime = sunrise.getTime() - 10 * MIN <= wakeEnd.getTime();
  if (dry && feels >= 38 && wind < 15 && sunInTime) {
    const wake = new Date(Math.max(sunrise.getTime() - 10 * MIN, earliest.getTime()));
    return { wake, act: 'bike', sunrise, why: `Sun's up at ${fmt(sunrise)}, about ${temp}° and dry. Good biking morning.` };
  }
  let why;
  if (!sunInTime) why = `Sun's not up until ${fmt(sunrise)}`;
  else if (storm) why = 'Storms around sunrise';
  else if (!dry) why = `${Math.round(pop)}% chance of rain around sunrise`;
  else if (feels < 38) why = `Feels like ${Math.round(feels)}° at sunrise`;
  else why = `Winds up to ${Math.round(wind)} mph`;
  return { wake: wakeStart, act: indoor, sunrise, why: `${why}, so ${ACT[indoor].toLowerCase()} instead.` };
}

/* ---------- parts of the day ---------- */
function blocks(date) {
  const p = prof(date), n = nightProf(date), we = isWeekend(date), plan = morningPlan(date);
  return [
    { id: 'morning', name: 'Morning', start: plan.wake, end: at(date, we ? '10:00' : '08:00'), list: 'morning', plan },
    { id: 'home', name: we ? 'Around the house' : 'After work', start: at(date, p.homeAt), end: at(date, we ? '12:00' : n.kidStart), list: we ? 'weekendHome' : 'home' },
    { id: 'project', name: 'Project hour', start: at(date, p.projectAt), end: new Date(at(date, p.projectAt).getTime() + 60 * MIN) },
    { id: 'kid', name: 'Bedtime routine', start: at(date, n.kidStart), end: at(date, n.kidEnd), list: 'kid' },
    { id: 'night', name: 'Wind down', start: at(date, n.windDown), end: at(date, n.bedLatest), list: 'night' },
  ].sort((a, b) => a.start - b.start);
}

function listDone(list, log) { const items = S.lists[list] || []; return items.length > 0 && items.every((i) => log.checks[i.id]); }
function blockDone(b, log) {
  if (b.id === 'morning') return !!log.exercise && listDone('morning', log) && peekPlan(b.start).length > 0;
  if (b.id === 'project') return !!(log.project && log.project.minutes);
  if (b.id === 'night') return listDone('night', log) && log.mood != null;
  return listDone(b.list, log);
}
function blockCount(b, log) {
  const items = b.list ? S.lists[b.list] : [];
  let total = items.length, done = items.filter((i) => log.checks[i.id]).length;
  if (b.id === 'morning') { total += 2; if (log.exercise) done++; if (peekPlan(b.start).length) done++; }
  if (b.id === 'project') { total = 1; done = log.project && log.project.minutes ? 1 : 0; }
  if (b.id === 'night') { total++; if (log.mood != null) done++; }
  return { done, total };
}

/* ---------- projects ---------- */
const activeProjects = () => S.projects.filter((p) => !p.archived);
const nextStep = (p) => p.steps.find((s) => !s.done);
function suggestedProject(date) {
  const log = peekLog(date);
  if (log.projectPick) { const p = S.projects.find((x) => x.id === log.projectPick); if (p && !p.archived) return p; }
  return activeProjects().slice().sort((a, b) => (a.last || 0) - (b.last || 0))[0] || null;
}

/* ---------- goals ---------- */
function goalHit(g, date) {
  const log = peekLog(date);
  if (g.source === 'exercise') return !!log.exercise && log.exercise !== 'rest';
  if (g.source === 'project') return !!(log.project && log.project.minutes >= 20);
  if (g.source === 'bed') return log.bedOnTime === true;
  if (g.source === 'home') return listDone(isWeekend(date) ? 'weekendHome' : 'home', log) && listDone('kid', log);
  if (g.source.startsWith('item:')) return !!log.checks[g.source.slice(5)];
  return !!log.manual[g.id] || peekPlan(date).some((t) => t.goal === g.id && t.done);
}
function weekCount(g, date) {
  const mon = mondayOf(date);
  let n = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(mon, i); if (d <= date && goalHit(g, d)) n++; }
  return n;
}

/* ---------- reminders (Android app only) ---------- */
let reminderTimer = null;
function scheduleReminders() {
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(sendReminders, 400);
}
function sendReminders() {
  const bridge = app();
  if (!bridge) return;
  const list = [];
  if (S.remindersOn) {
    const now = Date.now(), today = startOfDay(new Date());
    const add = (id, when, title, body, url) => { if (when.getTime() > now + 30e3) list.push({ id, at: when.getTime(), title, body, url: url || '' }); };
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i), p = prof(d), n = nightProf(d), log = peekLog(d), we = isWeekend(d);
      if (!we && S.briefingUrl) add(i * 10 + 7, at(d, S.briefingAt), 'Your morning briefing is ready', 'Email, calendar, Teams and Slack, sorted by Kikker. Tap to open.', S.briefingUrl);
      const plan = morningPlan(d);
      add(i * 10 + 1, plan.wake, plan.act === 'bike' ? 'Good morning! Bike time' : 'Good morning', plan.why);
      if (!listDone(we ? 'weekendHome' : 'home', log)) {
        add(i * 10 + 2, at(d, p.homeAt), we ? 'Around the house' : 'Home stretch', (S.lists[we ? 'weekendHome' : 'home'] || []).map((x) => x.text).slice(0, 3).join(' · '));
      }
      add(i * 10 + 3, new Date(at(d, n.kidStart).getTime() - 15 * MIN), 'Bedtime routine in 15 minutes', `Starts at ${fmt(at(d, n.kidStart))}.`);
      if (!(log.project && log.project.minutes)) {
        const pr = suggestedProject(d), st = pr && nextStep(pr);
        add(i * 10 + 4, at(d, p.projectAt), 'Project hour', pr ? `${pr.name}${st ? `: ${st.text}` : ''}` : 'Pick a project for the next hour.');
      }
      add(i * 10 + 5, at(d, n.windDown), 'Time to wind down', `Lights out by ${fmt(at(d, n.bedLatest))}. Do your quick check-out with Kikker.`);
      add(i * 10 + 6, at(d, n.bed), 'Bedtime', `Aim to be asleep by ${fmt(at(d, n.bedLatest))}.`);
    }
    const tl = dayLog(new Date());
    if (tl.timerStart && !tl.project) add(900, new Date(tl.timerStart + 60 * MIN), "Hour's up!", 'Nice work. Log what you did so Kikker can track it.');
  }
  try { bridge.setReminders(JSON.stringify(list)); } catch { /* bridge unavailable */ }
}

/* ---------- Kikker in the header ---------- */
function kikkerNow(now, bl, log) {
  if (typeof kikkerSvg !== 'function') return '';
  const p = nightProf(now);
  const night = now >= at(now, p.windDown) || now < bl[0].start;
  const morning = bl.find((b) => b.id === 'morning');
  const inMorning = now >= morning.start && now < morning.end;
  const c = bl.map((b) => blockCount(b, log)).reduce((a, x) => ({ done: a.done + x.done, total: a.total + x.total }), { done: 0, total: 0 });
  const keys = new Set(night ? ['nightcap', 'sleeves', 'pants'] : inMorning && morning.plan.act !== 'rest' ? ['headband', 'tee', 'shorts'] : ['sleeves', 'pants']);
  const mood = night ? 'sleepy' : c.done / Math.max(1, c.total) >= 0.5 ? 'happy' : 'meh';
  return kikkerSvg(keys, { night, sunny: inMorning && morning.plan.act === 'bike', mood });
}

function sayLine(now, bl, log) {
  const cur = bl.find((b) => now >= b.start && now < b.end);
  const nxt = bl.find((b) => b.start > now);
  if (cur && cur.id === 'morning') return cur.plan.act === 'bike' ? cur.plan.why : `${ACT[cur.plan.act]} this morning. ${cur.plan.why}`;
  if (cur && cur.id === 'project') { const pr = suggestedProject(now); return pr ? `Your hour: ${pr.name}. One small step counts.` : 'Pick a project for this hour.'; }
  if (cur && cur.id === 'kid') return 'Bedtime routine with your daughter. Phone down, you’ve got this.';
  if (cur && cur.id === 'night') return log.mood == null ? 'Wind down and do your 30-second check-out.' : 'Checked out. Sleep well!';
  if (cur && cur.id === 'home') return 'Knock out the must-dos, then your project hour is yours.';
  if (!nxt) {
    const tm = morningPlan(addDays(startOfDay(now), 1));
    return `Day’s done. Tomorrow: ${ACT[tm.act].toLowerCase()}, up at ${fmt(tm.wake)}.`;
  }
  return `Next up: ${nxt.name.toLowerCase()} at ${fmt(nxt.start)}.`;
}

/* ---------- rendering ---------- */
const open = new Set();
let tab = 'today';

function render() {
  const now = new Date(), today = startOfDay(now), bl = blocks(today), log = peekLog(today);
  const h = now.getHours();
  $('hello').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${S.name ? `, ${S.name}` : ''}`;
  $('say').textContent = sayLine(now, bl, log);
  const nxt = bl.find((b) => b.start > now);
  $('next').innerHTML = nxt ? `Next: <b>${esc(nxt.name)}</b> at ${fmt(nxt.start)}` : `Bedtime target: <b>${fmt(at(now, nightProf(now).bed))}–${fmt(at(now, nightProf(now).bedLatest))}</b>`;
  const c = bl.map((b) => blockCount(b, log)).reduce((a, x) => ({ done: a.done + x.done, total: a.total + x.total }), { done: 0, total: 0 });
  $('progBar').style.width = `${Math.round(c.done / Math.max(1, c.total) * 100)}%`;
  $('progTxt').textContent = `${c.done} of ${c.total} done today`;
  $('dateTxt').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) + (dayKind(now) ? ` · ${dayKind(now)}` : '');
  $('kikker').innerHTML = kikkerNow(now, bl, log);

  if (tab === 'today') renderToday(now, today, bl, log);
  if (tab === 'plan') renderPlan(now);
  if (tab === 'goals') renderGoals(now);
  if (tab === 'projects') renderProjects(now);
  if (tab === 'settings') renderSettings();
}

function checklist(list, log) {
  return `<ul class="checks">${(S.lists[list] || []).map((i) => `<li><label><input type="checkbox" data-act="check" data-id="${i.id}"${log.checks[i.id] ? ' checked' : ''}><span>${esc(i.text)}</span></label></li>`).join('')}</ul>`;
}

function renderToday(now, today, bl, log) {
  const cur = bl.find((b) => now >= b.start && now < b.end);
  const html = [];
  if (!isWeekend(now) && S.briefingUrl && now.getHours() < 17) {
    const ready = now >= at(today, S.briefingAt);
    html.push(`<a class="brief" href="${esc(S.briefingUrl)}" target="_blank" rel="noopener">
      <span class="bicon" aria-hidden="true">☀</span><span><b>Morning briefing</b><small>${ready ? 'Email, calendar, Teams and Slack, sorted. Tap to open.' : `Ready around ${fmt(at(today, S.briefingAt))}.`}</small></span><span class="arrow" aria-hidden="true">›</span></a>`);
  }
  html.push(planCard(today));
  if (!S.loc) {
    html.push(`<div class="card"><b>Let Kikker check the sunrise</b><p class="note" style="margin:0">Your location is used only for the morning weather, and stays on this phone.</p><div class="row"><button class="btn primary" data-act="gps">Use my location</button><button class="btn" data-act="tab" data-tab="settings">Search a town</button></div></div>`);
  }
  for (const b of bl) {
    const cnt = blockCount(b, log), done = blockDone(b, log), isNow = cur && cur.id === b.id;
    const expanded = open.has(b.id) || (isNow && !open.has('!' + b.id));
    const pill = done ? '<span class="pill done">Done</span>' : isNow ? '<span class="pill now">Now</span>' : `<span class="pill">${cnt.done}/${cnt.total}</span>`;
    let sub = '';
    if (b.id === 'morning') sub = `${ACT[b.plan.act]} · up at ${fmt(b.plan.wake)}`;
    if (b.id === 'project') {
      const pr = log.project ? S.projects.find((x) => x.id === log.project.id) : suggestedProject(today);
      sub = pr ? pr.name : 'Add a project';
    }
    if (b.id === 'night') sub = `Bed ${fmt(at(today, nightProf(today).bed))}–${fmt(at(today, nightProf(today).bedLatest))}`;
    if (b.id === 'kid') sub = `${fmt(b.start)}–${fmt(b.end)}`;
    html.push(`<article class="block${isNow ? ' now' : ''}"><button class="bhead" data-act="toggle" data-block="${b.id}" aria-expanded="${expanded}">
      <span class="when num">${fmt(b.start)}</span><span><h3>${esc(b.name)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span>${pill}</button>
      ${expanded ? `<div class="bbody">${blockBody(b, log, today)}</div>` : ''}</article>`);
  }
  $('view-today').innerHTML = html.join('');
}

function blockBody(b, log, today) {
  if (b.id === 'morning') {
    const pl = b.plan;
    return `<div class="plan"><b>${esc(ACT[pl.act])}, up at ${fmt(pl.wake)}</b><p>${esc(pl.why)}</p></div>
      <div><div class="note" style="margin-bottom:6px">What did you do?</div><div class="choices">${['bike', 'karate', 'workout', 'rest'].map((a) => `<button class="choice${log.exercise === a ? ' on' : ''}" data-act="exercise" data-v="${a}">${ACT[a]}</button>`).join('')}</div></div>
      ${checklist('morning', log)}
      <button class="btn${peekPlan(today).length ? '' : ' primary'}" data-act="tab" data-tab="plan">${peekPlan(today).length ? 'Open today’s plan' : 'Plan your top 3'}</button>`;
  }
  if (b.id === 'project') return projectBody(log, today);
  if (b.id === 'night') return nightBody(log, today);
  return checklist(b.list, log);
}

function projectBody(log, today) {
  const projects = activeProjects();
  if (!projects.length) return '<p class="note">No projects yet. Add one on the Projects tab.</p><button class="btn" data-act="tab" data-tab="projects">Add a project</button>';
  const pr = suggestedProject(today), st = pr && nextStep(pr);
  const picker = `<label class="field">Working on<select data-act="pick">${projects.map((p) => `<option value="${p.id}"${p.id === pr.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
  if (log.project && log.project.minutes) {
    const p = S.projects.find((x) => x.id === log.project.id);
    return `<div class="plan"><b>Done: ${log.project.minutes} min on ${esc(p ? p.name : 'a project')}</b>${log.project.note ? `<p>${esc(log.project.note)}</p>` : ''}</div><button class="btn ghost" data-act="unlogProject">Edit</button>`;
  }
  const running = log.timerStart && !log.project;
  const elapsed = running ? Math.floor((Date.now() - log.timerStart) / MIN) : 0;
  return `${picker}<div class="plan"><b>${st ? 'Next step: ' + esc(st.text) : 'No next step yet'}</b><p>${pr.last ? `Last worked ${ago(pr.last)}.` : 'Not started yet.'} One small step counts.</p></div>
    ${running ? `<div class="row" style="justify-content:space-between"><span class="timer num" id="timerTxt">${timerText(log.timerStart)}</span><button class="btn" data-act="stopTimer">Stop</button></div>` : '<button class="btn primary" data-act="startTimer">Start the hour</button>'}
    <details${running && elapsed >= 1 ? ' open' : ''}><summary class="note">Log it</summary>
      <div class="bbody" style="padding:10px 0 0">
        <label class="field">Minutes<input id="pjMin" type="number" inputmode="numeric" min="5" max="300" value="${running ? Math.max(5, elapsed) : 60}"></label>
        <label class="field">What did you do?<input id="pjNote" type="text" placeholder="e.g. sanded the neck to 220"></label>
        ${st ? `<div class="checks"><label><input type="checkbox" id="pjStepDone"><span>Finished: ${esc(st.text)}</span></label></div>` : ''}
        <label class="field">Next small step<input id="pjNext" type="text" placeholder="What's next time?"></label>
        <button class="btn primary" data-act="logProject" data-id="${pr.id}">Save</button>
      </div></details>`;
}

function nightBody(log, today) {
  const p = nightProf(today), tm = morningPlan(addDays(today, 1));
  const faces = ['😞', '😕', '😐', '🙂', '😄'];
  return `${checklist('night', log)}
    <div><div class="note" style="margin-bottom:6px">How did today feel?</div><div class="moods">${faces.map((f, i) => `<button class="mood${log.mood === i + 1 ? ' on' : ''}" data-act="mood" data-v="${i + 1}" aria-label="Mood ${i + 1} of 5">${f}</button>`).join('')}</div></div>
    <label class="field">What went well?<textarea id="wins" placeholder="One or two things">${esc(log.wins || '')}</textarea></label>
    <label class="field">One thing for tomorrow<input id="tmrw" type="text" value="${esc(log.tomorrow || '')}"></label>
    <div class="choices"><button class="choice${log.bedOnTime === true ? ' on' : ''}" data-act="bed" data-v="yes">In bed by ${fmt(at(today, p.bedLatest))}</button><button class="choice${log.bedOnTime === false ? ' on' : ''}" data-act="bed" data-v="no">Stayed up late</button></div>
    <button class="btn primary" data-act="saveNight">Save check-out</button>
    <div class="plan"><b>Tomorrow: ${esc(ACT[tm.act])}, up at ${fmt(tm.wake)}</b><p>${esc(tm.why)}</p></div>
    ${app() && app().setAlarm ? `<button class="btn" data-act="alarm" data-t="${tm.wake.getHours()}:${tm.wake.getMinutes()}">Set alarm for ${fmt(tm.wake)}</button>` : ''}`;
}

const ago = (t) => { const d = Math.round((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const timerText = (start) => { const left = Math.max(0, start + 60 * MIN - Date.now()); return left ? `${Math.floor(left / MIN)}:${pad(Math.floor(left % MIN / 1000))}` : "Hour's up!"; };

/* ---------- planner views ---------- */
let planOff = 0; // 0 = today, 1 = tomorrow, -1 = yesterday
const dayName = (off, d) => (off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : off === -1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long' }));

function taskRow(t, off) {
  const goal = t.goal && S.goals.find((g) => g.id === t.goal);
  return `<li class="task${t.done ? ' done' : ''}"><label><input type="checkbox" data-act="ptask" data-off="${off}" data-id="${t.id}"${t.done ? ' checked' : ''}><span>${esc(t.text)}${goal ? `<small>Goal: ${esc(goal.name)}</small>` : t.src ? `<small>From ${esc(t.src)}</small>` : ''}</span></label>
    <button class="star${t.top ? ' on' : ''}" data-act="ptop" data-off="${off}" data-id="${t.id}" aria-label="${t.top ? 'Remove from top 3' : 'Make it a top 3'}">★</button>
    <button class="x" data-act="pdel" data-off="${off}" data-id="${t.id}" aria-label="Remove task">✕</button></li>`;
}

/** Compact card on the Today view: the top 3 and a way into the planner. */
function planCard(today) {
  const plan = peekPlan(today);
  if (!plan.length) {
    const left = leftovers(today);
    return `<div class="card plancard"><b>Today’s plan</b><p class="note" style="margin:0">Nothing planned yet. Pick your top 3${left ? `, or bring over ${left.tasks.length} unfinished from ${left.date.toLocaleDateString([], { weekday: 'long' })}` : ''}.</p>
      <div class="row"><button class="btn primary" data-act="tab" data-tab="plan">Plan my day</button>${left ? `<button class="btn" data-act="pcarry" data-off="0">Bring them over</button>` : ''}</div></div>`;
  }
  const top = plan.filter((t) => t.top), rest = plan.length - top.length, done = plan.filter((t) => t.done).length;
  return `<div class="card plancard"><div class="row" style="justify-content:space-between"><b>Today’s plan</b><span class="pill${done === plan.length ? ' done' : ''}">${done}/${plan.length}</span></div>
    <ul class="tasks">${(top.length ? top : plan.slice(0, TOP)).map((t) => taskRow(t, 0)).join('')}</ul>
    <button class="btn ghost" data-act="tab" data-tab="plan">${rest > 0 && top.length ? `${rest} more · ` : ''}Open planner</button></div>`;
}

function renderPlan(now) {
  const d = addDays(startOfDay(now), planOff), plan = peekPlan(d);
  const top = plan.filter((t) => t.top), rest = plan.filter((t) => !t.top);
  const left = planOff >= 0 ? leftovers(d) : null;
  const goals = S.goals.filter((g) => !plan.some((t) => t.goal === g.id));
  const pr = suggestedProject(d), st = pr && nextStep(pr);
  const chips = [
    ...goals.map((g) => `<button class="choice" data-act="pgoal" data-id="${g.id}">+ ${esc(g.name)}</button>`),
    st && !plan.some((t) => t.text === `${pr.name}: ${st.text}`) ? `<button class="choice" data-act="pstep">+ ${esc(pr.name)}: ${esc(st.text)}</button>` : '',
  ].join('');
  $('view-plan').innerHTML = `
    <div class="daynav"><button class="btn ghost" data-act="pday" data-v="-1"${planOff <= -1 ? ' disabled' : ''} aria-label="Previous day">‹</button>
      <h2 style="margin:0">${dayName(planOff, d)} <small>${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</small></h2>
      <button class="btn ghost" data-act="pday" data-v="1"${planOff >= 6 ? ' disabled' : ''} aria-label="Next day">›</button></div>
    <form class="row" id="taskForm"><input id="taskTxt" type="text" placeholder="Add a task or goal for ${dayName(planOff, d).toLowerCase()}" autocomplete="off" style="flex:1;min-width:0;padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg)"><button class="btn primary">Add</button></form>
    ${left && !plan.some((t) => left.tasks.some((l) => l.text === t.text)) ? `<div class="card"><b>${left.tasks.length} unfinished from ${left.date.toLocaleDateString([], { weekday: 'long' })}</b><p class="note" style="margin:0">${left.tasks.slice(0, 3).map((t) => esc(t.text)).join(' · ')}${left.tasks.length > 3 ? ' …' : ''}</p><div class="row"><button class="btn" data-act="pcarry" data-off="${planOff}">Bring them over</button></div></div>` : ''}
    <h2>Top 3 <small>${top.length > TOP ? `${top.length} starred, keep it to 3` : 'tap ★ to choose'}</small></h2>
    ${top.length ? `<ul class="tasks card">${top.map((t) => taskRow(t, planOff)).join('')}</ul>` : '<p class="note">Star up to three things that would make the day a win.</p>'}
    <h2>Also on the list</h2>
    ${rest.length ? `<ul class="tasks card">${rest.map((t) => taskRow(t, planOff)).join('')}</ul>` : '<p class="note">Nothing else yet.</p>'}
    ${chips ? `<h2>Quick add <small>from your goals and projects</small></h2><div class="choices">${chips}</div>` : ''}
    <details class="card"><summary class="note">Add several at once</summary>
      <label class="field" style="margin-top:8px">One per line<textarea id="taskMany" placeholder="Call the dentist&#10;Order guitar strings"></textarea></label>
      <button class="btn" data-act="pmany">Add them</button></details>
    <p class="note">Your morning briefing has “+ Planner” buttons that drop its to-dos straight in here.</p>`;
}

function renderGoals(now) {
  const mon = mondayOf(now), groups = {};
  for (const g of S.goals) (groups[g.pillar] = groups[g.pillar] || []).push(g);
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const html = ['<h2>This week <small>Mon–Sun</small></h2>'];
  for (const [pillar, gs] of Object.entries(groups)) {
    html.push(`<h2>${esc(pillar)}</h2>`);
    for (const g of gs) {
      const n = weekCount(g, now);
      html.push(`<div class="goal"><div><h3>${esc(g.name)}</h3><div class="meta">${sourceLabel(g)}</div></div>
        <span class="score num${n >= g.target ? ' met' : ''}">${n}/${g.target}</span>
        <div class="dots">${days.map((l, i) => { const d = addDays(mon, i); return `<span class="dot${d <= now && goalHit(g, d) ? ' hit' : ''}${ymd(d) === ymd(now) ? ' today' : ''}"><i></i>${l}</span>`; }).join('')}</div>
        <div class="row" style="grid-column:1/-1">${g.source === 'manual' ? `<button class="btn${peekLog(now).manual[g.id] ? ' primary' : ''}" data-act="manual" data-id="${g.id}">${peekLog(now).manual[g.id] ? 'Done today ✓' : 'Did it today'}</button>` : ''}<button class="btn ghost" data-act="editGoal" data-id="${g.id}">Edit</button></div></div>`);
    }
  }
  html.push('<button class="btn" data-act="editGoal" data-id="">Add a goal</button>');
  $('view-goals').innerHTML = html.join('');
}
function sourceLabel(g) {
  if (g.source === 'exercise') return 'Counts mornings you log exercise';
  if (g.source === 'project') return 'Counts days with 20+ project minutes';
  if (g.source === 'bed') return 'Counts nights you check in bed on time';
  if (g.source === 'home') return 'Counts days the home and bedtime lists are done';
  if (g.source.startsWith('item:')) { const it = Object.values(S.lists).flat().find((i) => i.id === g.source.slice(5)); return it ? `Counts “${esc(it.text)}”` : 'Linked checklist item was removed'; }
  return 'Tap “Did it today” when you do it';
}

function renderProjects(now) {
  const html = ['<h2>Projects <small>Kikker rotates the least-recent one</small></h2>'];
  for (const p of activeProjects()) {
    const st = nextStep(p);
    html.push(`<button class="proj" data-act="openProject" data-id="${p.id}"><h3>${esc(p.name)}</h3><span class="meta">${st ? 'Next: ' + esc(st.text) : 'No next step'} · ${p.last ? 'worked ' + ago(p.last) : 'not started'}</span></button>`);
  }
  html.push('<div class="card"><label class="field">New project<input id="newProj" type="text" placeholder="e.g. Plan the camping trip"></label><button class="btn primary" data-act="addProject">Add project</button></div>');
  const archived = S.projects.filter((p) => p.archived);
  if (archived.length) html.push(`<h2>Archived</h2>${archived.map((p) => `<button class="proj" data-act="openProject" data-id="${p.id}"><h3>${esc(p.name)}</h3><span class="meta">Archived</span></button>`).join('')}`);
  $('view-projects').innerHTML = html.join('');
}

function projectSheet(id) {
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  $('panel').innerHTML = `<h3>${esc(p.name)}</h3>
    <label class="field">Name<input id="pName" type="text" value="${esc(p.name)}"></label>
    <div><div class="note">Steps</div><ul class="steps">${p.steps.map((s) => `<li class="${s.done ? 'done' : ''}"><input type="checkbox" data-act="stepDone" data-p="${p.id}" data-id="${s.id}"${s.done ? ' checked' : ''} style="width:20px;height:20px;accent-color:var(--good)"><span>${esc(s.text)}</span><button class="x" data-act="stepDel" data-p="${p.id}" data-id="${s.id}" aria-label="Remove step">✕</button></li>`).join('') || '<li class="note">No steps yet.</li>'}</ul></div>
    <div class="row"><input id="newStep" type="text" placeholder="Add a step" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg)"><button class="btn" data-act="stepAdd" data-p="${p.id}">Add</button></div>
    ${p.notes.length ? `<div><div class="note">Log</div><ul class="loglist">${p.notes.slice(-8).reverse().map((n) => `<li><time>${new Date(n.at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${n.min} min</time>${esc(n.text || '')}</li>`).join('')}</ul></div>` : ''}
    <div class="row"><button class="btn primary" data-act="projSave" data-p="${p.id}">Done</button><button class="btn ghost" data-act="projArchive" data-p="${p.id}">${p.archived ? 'Restore' : 'Archive'}</button></div>`;
  $('sheet').hidden = false;
}

function goalSheet(id) {
  const g = S.goals.find((x) => x.id === id) || { id: '', name: '', pillar: 'Mental', target: 3, source: 'manual' };
  const pillars = [...new Set(['Physical', 'Mental', 'Family & social', 'Spiritual', ...S.goals.map((x) => x.pillar)])];
  $('panel').innerHTML = `<h3>${g.id ? 'Edit goal' : 'New goal'}</h3>
    <label class="field">Goal<input id="gName" type="text" value="${esc(g.name)}" placeholder="e.g. Call a friend"></label>
    <label class="field">Area<select id="gPillar">${pillars.map((p) => `<option${p === g.pillar ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label class="field">Days per week<input id="gTarget" type="number" min="1" max="7" value="${g.target}"></label>
    <p class="note" style="margin:0">${g.id ? sourceLabel(g) : 'New goals are tracked with a “Did it today” button.'}</p>
    <div class="row"><button class="btn primary" data-act="goalSave" data-id="${g.id}">Save</button>${g.id ? `<button class="btn ghost" data-act="goalDel" data-id="${g.id}">Delete</button>` : ''}</div>`;
  $('sheet').hidden = false;
}

const TIMES = [
  ['wakeStart', 'Wake window starts'], ['wakeEnd', 'Wake window ends'], ['wakeEarliest', 'Earliest wake for biking'],
  ['homeAt', 'Home tasks start'], ['kidStart', "Daughter's bedtime starts"], ['kidEnd', "Daughter's bedtime ends"],
  ['projectAt', 'Project hour'], ['windDown', 'Wind down'], ['bed', 'Bedtime'], ['bedLatest', 'Latest bedtime'],
];
const LISTS = [['morning', 'Morning checklist'], ['home', 'After work (weekdays)'], ['weekendHome', 'Around the house (weekends)'], ['kid', 'Bedtime routine'], ['night', 'Wind-down checklist']];

function renderSettings() {
  const times = (k) => `<div class="times">${TIMES.map(([f, l]) => `<label class="field">${l}<input type="time" data-set="${k}.${f}" value="${S[k][f]}"></label>`).join('')}</div>`;
  const bridge = app();
  $('view-settings').innerHTML = `
    <h2>You</h2><div class="card"><label class="field">Your first name (optional)<input id="sName" type="text" value="${esc(S.name)}"></label></div>
    <h2>Location <small>for sunrise and weather</small></h2>
    <div class="card"><p class="note" style="margin:0">${S.loc ? `Using ${esc(S.loc.label || 'your location')}.` : 'Not set.'}</p>
      <div class="row"><button class="btn" data-act="gps">Use my location</button></div>
      <form class="row" id="locForm"><input id="locQ" type="search" placeholder="Search a town" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg)"><button class="btn">Search</button></form>
      <div id="locRes" class="row"></div></div>
    <h2>Morning briefing <small>weekdays</small></h2>
    <div class="card"><label class="field">Briefing page link<input id="sBrief" type="url" value="${esc(S.briefingUrl)}" placeholder="https://claude.ai/artifact/…"></label>
      <label class="field">Remind me at<input id="sBriefAt" type="time" value="${S.briefingAt}"></label>
      <p class="note" style="margin:0">A scheduled Claude routine refreshes this private page at 8:00 on weekdays. Using a different Claude account? Paste that account's briefing link here. Leave it blank to hide the briefing.</p></div>
    <h2>Weekdays <small>Sun–Thu nights use these bedtimes</small></h2><div class="card">${times('weekday')}</div>
    <h2>Weekends <small>Fri and Sat nights use these bedtimes</small></h2><div class="card">${times('weekend')}</div>
    <h2>Checklists <small>one item per line</small></h2>
    <div class="card">${LISTS.map(([k, l]) => `<label class="field">${l}<textarea data-list="${k}">${esc((S.lists[k] || []).map((i) => i.text).join('\n'))}</textarea></label>`).join('')}</div>
    <h2>Reminders</h2><div class="card">
      <div class="checks"><label><input type="checkbox" id="remOn"${S.remindersOn ? ' checked' : ''}><span>Remind me for each part of the day</span></label></div>
      <p class="note" style="margin:0">${bridge ? 'Reminders come from the Kikker Assistant Android app, and are scheduled 7 days ahead.' : 'Reminders need the Android app. This browser version can’t notify you when it’s closed.'}</p>
      ${bridge && bridge.testReminder ? '<button class="btn" data-act="testRem">Send a test reminder</button>' : ''}</div>
    <h2>Backup <small>your data lives only on this phone</small></h2>
    <div class="card"><div class="row"><button class="btn" data-act="copyBackup">Copy backup</button></div>
      <label class="field">Restore from a backup<textarea id="restoreTxt" placeholder="Paste a backup here"></textarea></label>
      <button class="btn" data-act="restore">Restore</button></div>
    <p class="note">Weather: Open-Meteo. Kikker Assistant stores everything on this device.</p>`;
}

function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2200); }

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-tab]');
  if (!t) { if (e.target === $('sheet')) $('sheet').hidden = true; return; }
  if (t.classList.contains('tab')) { setTab(t.dataset.tab); return; }
  const act = t.dataset.act, today = startOfDay(new Date()), log = dayLog(today);
  switch (act) {
    case 'tab': setTab(t.dataset.tab); break;
    case 'toggle': {
      const id = t.dataset.block, expanded = t.getAttribute('aria-expanded') === 'true';
      if (expanded) { open.delete(id); open.add('!' + id); } else { open.add(id); open.delete('!' + id); }
      render(); break;
    }
    case 'exercise': log.exercise = log.exercise === t.dataset.v ? null : t.dataset.v; save(); render(); break;
    case 'mood': log.mood = +t.dataset.v; save(); render(); break;
    case 'bed': log.bedOnTime = t.dataset.v === 'yes'; save(); render(); break;
    case 'saveNight': {
      log.wins = $('wins').value.trim(); log.tomorrow = $('tmrw').value.trim();
      const added = log.tomorrow ? addTasks([log.tomorrow], addDays(today, 1), { top: true }) : 0;
      save(); toast(added ? 'Saved, and added to tomorrow’s plan. Sleep well!' : 'Check-out saved. Sleep well!'); render(); break;
    }
    case 'pday': planOff = Math.max(-1, Math.min(6, planOff + Number(t.dataset.v))); render(); break;
    case 'ptop': case 'pdel': {
      const d = addDays(today, Number(t.dataset.off)), plan = planOf(d), task = plan.find((x) => x.id === t.dataset.id);
      if (!task) break;
      if (act === 'pdel') S.plans[ymd(d)] = plan.filter((x) => x !== task);
      else task.top = !task.top;
      save(true); render(); break;
    }
    case 'pcarry': {
      const d = addDays(today, Number(t.dataset.off)), left = leftovers(d);
      if (!left) break;
      const n = left.tasks.reduce((s, x) => s + addTasks([x.text], d, x.goal ? { carried: true, goal: x.goal } : { carried: true }), 0);
      left.tasks.forEach((x) => { x.moved = true; });
      save(true); toast(`Brought over ${n} task${n === 1 ? '' : 's'}`); render(); break;
    }
    case 'pgoal': { const g = S.goals.find((x) => x.id === t.dataset.id); if (g) { addTasks([g.name], addDays(today, planOff), { goal: g.id }); save(true); render(); } break; }
    case 'pstep': { const d = addDays(today, planOff), pr = suggestedProject(d), st = pr && nextStep(pr); if (st) { addTasks([`${pr.name}: ${st.text}`], d); save(true); render(); } break; }
    case 'pmany': {
      const n = addTasks($('taskMany').value.split('\n'), addDays(today, planOff));
      save(true); toast(n ? `Added ${n}` : 'Nothing new to add'); render(); break;
    }
    case 'alarm': { const [hh, mm] = t.dataset.t.split(':').map(Number); try { app().setAlarm(hh, mm, 'Kikker: good morning'); } catch { toast('Could not open the clock app'); } break; }
    case 'startTimer': log.timerStart = Date.now(); save(); render(); break;
    case 'stopTimer': render(); { const d = document.querySelector('details'); if (d) d.open = true; } break;
    case 'logProject': {
      const p = S.projects.find((x) => x.id === t.dataset.id);
      const min = Math.max(1, Math.min(300, parseInt($('pjMin').value, 10) || 0));
      const note = $('pjNote').value.trim(), nextTxt = $('pjNext').value.trim();
      const st = nextStep(p);
      if (st && $('pjStepDone') && $('pjStepDone').checked) { st.done = true; st.doneAt = Date.now(); }
      if (nextTxt) p.steps.push({ id: uid(), text: nextTxt, done: false });
      p.last = Date.now();
      p.notes.push({ at: Date.now(), min, text: note });
      log.project = { id: p.id, minutes: min, note };
      delete log.timerStart;
      save(); toast(`Logged ${min} min on ${p.name}`); render(); break;
    }
    case 'unlogProject': {
      const p = S.projects.find((x) => x.id === (log.project && log.project.id));
      if (p && p.notes.length) p.notes.pop();
      delete log.project; save(); render(); break;
    }
    case 'gps': useGps(); break;
    case 'manual': { const g = t.dataset.id; log.manual[g] = !log.manual[g]; save(); render(); break; }
    case 'editGoal': goalSheet(t.dataset.id); break;
    case 'goalSave': {
      const name = $('gName').value.trim();
      if (!name) { toast('Give the goal a name'); break; }
      const target = Math.max(1, Math.min(7, parseInt($('gTarget').value, 10) || 1));
      const g = S.goals.find((x) => x.id === t.dataset.id);
      if (g) Object.assign(g, { name, pillar: $('gPillar').value, target });
      else S.goals.push({ id: uid(), name, pillar: $('gPillar').value, target, source: 'manual' });
      save(); $('sheet').hidden = true; render(); break;
    }
    case 'goalDel': S.goals = S.goals.filter((x) => x.id !== t.dataset.id); save(); $('sheet').hidden = true; render(); break;
    case 'openProject': projectSheet(t.dataset.id); break;
    case 'addProject': {
      const name = $('newProj').value.trim();
      if (!name) break;
      S.projects.push({ id: uid(), name, steps: [], notes: [], last: 0, archived: false });
      save(); render(); toast(`Added ${name}`); break;
    }
    case 'stepDone': { const p = S.projects.find((x) => x.id === t.dataset.p), s = p.steps.find((x) => x.id === t.dataset.id); s.done = !s.done; save(); projectSheet(p.id); break; }
    case 'stepDel': { const p = S.projects.find((x) => x.id === t.dataset.p); p.steps = p.steps.filter((x) => x.id !== t.dataset.id); save(); projectSheet(p.id); break; }
    case 'stepAdd': { const p = S.projects.find((x) => x.id === t.dataset.p), v = $('newStep').value.trim(); if (v) { p.steps.push({ id: uid(), text: v, done: false }); save(); projectSheet(p.id); } break; }
    case 'projSave': { const p = S.projects.find((x) => x.id === t.dataset.p), v = $('pName').value.trim(); if (v) p.name = v; save(); $('sheet').hidden = true; render(); break; }
    case 'projArchive': { const p = S.projects.find((x) => x.id === t.dataset.p); p.archived = !p.archived; save(); $('sheet').hidden = true; render(); break; }
    case 'copyBackup': {
      const txt = JSON.stringify({ ...S, wx: null });
      try { await navigator.clipboard.writeText(txt); toast('Backup copied. Paste it somewhere safe.'); } catch { $('restoreTxt').value = txt; $('restoreTxt').select(); toast('Select all and copy the text below'); }
      break;
    }
    case 'restore': {
      try {
        const s = JSON.parse($('restoreTxt').value);
        if (!s || s.v !== 1 || !s.lists) throw new Error('bad');
        S = s; save(); toast('Restored'); render();
      } catch { toast('That doesn’t look like a Kikker backup'); }
      break;
    }
    case 'testRem': try { app().testReminder(); } catch { /* not available */ } break;
    case 'pickLoc': S.loc = JSON.parse(t.dataset.loc); S.wx = null; save(); await loadWeather(true); save(); toast(`Using ${S.loc.label}`); render(); break;
    default: break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target, today = startOfDay(new Date()), log = dayLog(today);
  if (t.dataset.act === 'check') { log.checks[t.dataset.id] = t.checked; if (!t.checked) delete log.checks[t.dataset.id]; save(); render(); return; }
  if (t.dataset.act === 'ptask') {
    const task = planOf(addDays(today, Number(t.dataset.off))).find((x) => x.id === t.dataset.id);
    if (task) { task.done = t.checked; save(true); render(); }
    return;
  }
  if (t.dataset.act === 'pick') { log.projectPick = t.value; save(); render(); return; }
  if (t.dataset.set) { const [k, f] = t.dataset.set.split('.'); if (t.value) { S[k][f] = t.value; save(); render(); toast('Saved'); } return; }
  if (t.dataset.list) {
    const k = t.dataset.list, old = S.lists[k] || [];
    const lines = t.value.split('\n').map((x) => x.trim()).filter(Boolean);
    S.lists[k] = lines.map((text) => old.find((o) => o.text === text) || { id: uid(), text });
    save(); toast('Checklist saved'); return;
  }
  if (t.id === 'sName') { S.name = t.value.trim(); save(true); render(); return; }
  if (t.id === 'sBrief') {
    const v = t.value.trim();
    if (v && !/^https:\/\//.test(v)) { toast('The link should start with https://'); return; }
    S.briefingUrl = v; save(); toast(v ? 'Briefing link saved' : 'Briefing hidden'); return;
  }
  if (t.id === 'sBriefAt') { if (t.value) { S.briefingAt = t.value; save(); toast('Saved'); } return; }
  if (t.id === 'remOn') { S.remindersOn = t.checked; save(); return; }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'taskForm') {
    e.preventDefault();
    const v = $('taskTxt').value;
    if (addTasks([v], addDays(startOfDay(new Date()), planOff))) { save(true); render(); const i = $('taskTxt'); if (i) i.focus(); }
    return;
  }
  if (e.target.id !== 'locForm') return;
  e.preventDefault();
  const q = $('locQ').value.trim();
  if (!q) return;
  try {
    const j = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`).then((r) => r.json());
    const res = j.results || [];
    $('locRes').innerHTML = res.length ? res.map((x) => {
      const loc = { lat: x.latitude, lon: x.longitude, label: [x.name, x.country_code === 'US' ? x.admin1 : x.country].filter(Boolean).join(', ') };
      return `<button class="choice" data-act="pickLoc" data-loc='${esc(JSON.stringify(loc))}'>${esc(loc.label)}</button>`;
    }).join('') : '<span class="note">No places matched.</span>';
  } catch { $('locRes').innerHTML = '<span class="note">Search is unavailable right now.</span>'; }
});

function useGps() {
  if (!navigator.geolocation) { toast('Location isn’t available here. Search for your town instead.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    S.loc = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3), label: 'your location' };
    S.wx = null; save(); await loadWeather(true); save(); toast('Location saved'); render();
  }, () => toast('Location permission is off. Search for your town in Settings instead.'), { timeout: 12000, maximumAge: 30 * MIN });
}

function setTab(name) {
  tab = name;
  if (name === 'plan' && tab !== 'plan') planOff = 0;
  tab = name;
  for (const v of ['today', 'plan', 'goals', 'projects', 'settings']) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  window.scrollTo(0, 0);
  render();
}

/* keep the clock-driven parts fresh */
setInterval(() => {
  const el = $('timerTxt');
  const log = peekLog(new Date());
  if (el && log.timerStart) el.textContent = timerText(log.timerStart);
}, 1000);
let lastMinute = -1;
setInterval(() => {
  const m = new Date().getMinutes();
  if (m !== lastMinute && tab === 'today' && !document.activeElement.matches('input,textarea,select')) { lastMinute = m; render(); }
}, 20e3);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') { await loadWeather(); render(); scheduleReminders(); }
});

/* Briefing hand-off: "+ Planner" links open this page with #add=["task", ...] (the browser
   version), or the Android app calls window.kikkerAddTasks([...]). Either way the tasks land in
   today's plan. The hash never leaves the phone (it isn't sent to the server). */
window.kikkerAddTasks = function (list) {
  const n = addTasks(Array.isArray(list) ? list : [], startOfDay(new Date()), { src: 'briefing' });
  save(true);
  setTab('plan');
  toast(n ? `Added ${n} from your briefing` : 'Already in today’s plan');
  return n;
};
function importFromHash() {
  const m = location.hash.match(/^#add=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try { window.kikkerAddTasks(JSON.parse(decodeURIComponent(m[1]))); } catch { toast('Couldn’t read those tasks'); }
}
window.addEventListener('hashchange', importFromHash);

(async function start() {
  render();
  importFromHash();
  await loadWeather();
  render();
  scheduleReminders();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
