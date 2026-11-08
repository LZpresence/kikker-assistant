/* Kikker — the Kikker Assistant mascot (shared with Kikker Forecast), drawn after a well-loved green frog stuffy.
   kikkerSvg(outfit, scene) returns an SVG string. outfit is a Set of keys from wearFor():
   coat-winter, coat-heavy, coat-warm, jacket-light, wind, sleeves, tee, shorts, pants,
   hat, gloves, scarf, boots, umbrella, umbrella-maybe, sun, mask, headband, nightcap.
   scene: { precip: 'rain'|'snow'|null, thunder, sunny, night, windy, mood: 'happy'|'meh'|'cold'|'sleepy' } */
'use strict';

const KK = {
  skin: '#2f625f', shade: '#1f4644', hi: '#4f8a85', line: '#163533',
  iris: '#7a4622', pupil: '#1b1009',
};

function kikkerSvg(outfit, scene = {}) {
  const has = (k) => outfit.has(k);
  const uid = 'k' + Math.random().toString(36).slice(2, 7);
  const umbrella = has('umbrella');

  // pick one top layer
  let top = null;
  if (has('coat-winter')) top = 'winter';
  else if (has('coat-heavy')) top = 'heavy';
  else if (has('coat-warm')) top = 'warm';
  else if (has('jacket-light')) top = has('wind') ? 'wind' : 'fleece';
  else if (has('wind')) top = 'wind';
  else if (umbrella) top = 'rain';
  else if (has('sleeves')) top = 'sleeves';
  else top = 'tee';
  const TOPS = {
    winter: { c: '#c8562f', d: '#9c3f20', y: 128, long: true, puff: true, hood: true },
    heavy: { c: '#34507c', d: '#243a5c', y: 130, long: true, puff: true },
    warm: { c: '#a8432f', d: '#7f2f20', y: 132, long: true, zip: true, collar: true },
    fleece: { c: '#8b9aa5', d: '#6b7a85', y: 134, long: true, zip: true },
    wind: { c: '#2a8fbf', d: '#1d6c92', y: 134, long: true, zip: true },
    rain: { c: '#f2c230', d: '#c99a17', y: 134, long: true, buttons: true },
    sleeves: { c: '#6d4f8f', d: '#523a6c', y: 140, long: true },
    tee: { c: '#e9823a', d: '#c0642a', y: 140, long: false },
  };
  const T = TOPS[top];
  const pants = has('shorts') ? 'shorts' : 'pants';
  const P = { c: '#3d5f8f', d: '#2c4870' };

  const arms = { L: 'M62 130 C44 148 40 170 46 190', R: 'M178 130 C196 148 200 170 194 190' };
  const upper = { L: 'M62 130 C54 138 50 146 48 154', R: 'M178 130 C186 138 190 146 192 154' };
  const legs = { L: 'M94 186 C62 180 40 194 52 210 C58 218 70 220 84 220', R: 'M146 186 C178 180 200 194 188 210 C182 218 170 220 156 220' };
  const thighs = { L: 'M94 186 C72 182 58 188 54 198', R: 'M146 186 C168 182 182 188 186 198' };

  const s = [];
  s.push(`<svg class="kikker-svg" viewBox="0 0 240 240" role="img" aria-label="Kikker the frog, dressed for the weather"><defs>
    <radialGradient id="${uid}g" cx="40%" cy="28%" r="75%"><stop offset="0" stop-color="${KK.hi}"/><stop offset=".55" stop-color="${KK.skin}"/><stop offset="1" stop-color="${KK.shade}"/></radialGradient>
    <clipPath id="${uid}b"><ellipse cx="120" cy="142" rx="72" ry="62"/></clipPath>
    <clipPath id="${uid}c"><ellipse cx="120" cy="143" rx="77" ry="66"/></clipPath>
  </defs>`);

  /* ---- scene behind ---- */
  if (scene.sunny && !scene.night) {
    s.push('<g><circle cx="34" cy="36" r="15" fill="#ffb347"/><g stroke="#ffb347" stroke-width="3" stroke-linecap="round">'
      + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r1 = 21, r2 = 28, t = a * Math.PI / 180; return `<line x1="${(34 + r1 * Math.cos(t)).toFixed(1)}" y1="${(36 + r1 * Math.sin(t)).toFixed(1)}" x2="${(34 + r2 * Math.cos(t)).toFixed(1)}" y2="${(36 + r2 * Math.sin(t)).toFixed(1)}"/>`; }).join('')
      + '</g></g>');
  } else if (scene.night && !scene.precip) {
    s.push('<path d="M40 18a16 16 0 1 0 12 26a13 13 0 0 1-12-26z" fill="#d9e3ec"/><g fill="#d9e3ec"><circle cx="70" cy="22" r="1.6"/><circle cx="18" cy="62" r="1.4"/><circle cx="214" cy="30" r="1.6"/></g>');
  }
  if (scene.precip || scene.thunder) {
    s.push('<path d="M14 52h44a12 12 0 0 0 0-24a17 17 0 0 0-32-3a12 12 0 0 0-12 27z" fill="#c9d4de" opacity=".9"/>');
    if (scene.thunder) s.push('<path d="M38 52l-7 13h7l-4 12 12-16h-7l4-9z" fill="#ffd23f"/>');
  }
  if (scene.precip === 'rain') {
    s.push('<g stroke="#7fb8e6" stroke-width="2.4" stroke-linecap="round" opacity=".9">'
      + [[20, 70], [36, 92], [14, 112], [30, 134], [212, 96], [224, 128], [206, 150], [222, 170]].map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 11}"/>`).join('') + '</g>');
  } else if (scene.precip === 'snow') {
    s.push('<g fill="#ffffff" opacity=".95">'
      + [[22, 72], [40, 96], [14, 120], [32, 146], [210, 92], [226, 120], [204, 144], [220, 172], [196, 64]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${2.2 + (i % 2)}"/>`).join('') + '</g>');
  }
  if (scene.windy) {
    s.push('<g fill="none" stroke="#c9d4de" stroke-width="2.4" stroke-linecap="round" opacity=".8"><path d="M196 70h22a6 6 0 1 0-6-6"/><path d="M188 82h34a6 6 0 1 1-6 6"/><path d="M200 94h16"/></g>');
  }

  s.push(`<ellipse cx="120" cy="228" rx="74" ry="7" fill="#000" opacity=".22"/>`);

  /* ---- umbrella (behind arms so the hand grips it) ---- */
  if (umbrella) {
    s.push(`<line x1="150" y1="40" x2="193" y2="194" stroke="#3a2a1f" stroke-width="3.5" stroke-linecap="round"/>
      <g transform="rotate(-12 150 40)"><path d="M76 42 Q150 -16 224 42 Q212 33 199 42 Q187 33 175 42 Q162 33 150 42 Q138 33 125 42 Q113 33 101 42 Q88 33 76 42Z" fill="#d6453d"/>
      <path d="M150 -1 Q138 14 125 42 M150 -1 Q162 14 175 42" fill="none" stroke="#a8322b" stroke-width="2"/><circle cx="150" cy="-2" r="3" fill="#3a2a1f"/></g>`);
  }

  /* ---- legs, pants, feet ---- */
  for (const side of ['L', 'R']) s.push(`<path d="${legs[side]}" fill="none" stroke="${KK.skin}" stroke-width="20" stroke-linecap="round"/>`);
  if (pants === 'pants') for (const side of ['L', 'R']) s.push(`<path d="${legs[side]}" fill="none" stroke="${P.c}" stroke-width="22" stroke-linecap="round"/>`);
  else for (const side of ['L', 'R']) s.push(`<path d="${thighs[side]}" fill="none" stroke="${P.c}" stroke-width="25" stroke-linecap="round"/>`);
  for (const [x, flip] of [[84, 1], [156, -1]]) {
    if (has('boots')) {
      const bc = scene.precip === 'snow' ? '#6b4a2f' : '#f2c230';
      s.push(`<g transform="translate(${x} 220) scale(${flip} 1)"><rect x="-15" y="-15" width="30" height="24" rx="8" fill="${bc}"/><rect x="-20" y="4" width="36" height="9" rx="4.5" fill="${bc}"/><rect x="-20" y="10" width="36" height="4" rx="2" fill="#000" opacity=".25"/></g>`);
    } else {
      s.push(`<g transform="translate(${x} 218) scale(${flip} 1)" fill="${KK.skin}"><ellipse cx="2" cy="2" rx="15" ry="8"/><circle cx="-11" cy="8" r="5.5"/><circle cx="2" cy="11" r="5.5"/><circle cx="15" cy="8" r="5.5"/></g>`);
    }
  }

  /* ---- body ---- */
  s.push(`<ellipse cx="120" cy="142" rx="72" ry="62" fill="url(#${uid}g)"/>`);

  /* ---- top layer, clipped to the body ---- */
  const clip = T.puff ? `${uid}c` : `${uid}b`;
  s.push(`<g clip-path="url(#${clip})"><rect x="0" y="${T.y}" width="240" height="120" fill="${T.c}"/>`);
  if (!T.zip && !T.puff && !T.buttons) s.push(`<path d="M98 ${T.y - 1} Q120 ${T.y + 11} 142 ${T.y - 1}" fill="none" stroke="${T.d}" stroke-width="3.5" stroke-linecap="round"/>`);
  if (T.puff) s.push(`<g stroke="${T.d}" stroke-width="2.5" fill="none">${[156, 176, 196].map((y) => `<path d="M40 ${y} Q120 ${y + 8} 200 ${y}"/>`).join('')}</g>`);
  if (T.zip || T.puff) s.push(`<line x1="120" y1="${T.y + 2}" x2="120" y2="212" stroke="${T.d}" stroke-width="2.5"/><rect x="117" y="${T.y + 6}" width="6" height="9" rx="2" fill="#d7d7d7"/>`);
  if (T.buttons) s.push(`<g fill="${T.d}">${[150, 168, 186].map((y) => `<circle cx="120" cy="${y}" r="3"/>`).join('')}</g>`);
  if (T.hood) s.push(`<path d="M44 ${T.y + 2} Q120 ${T.y + 20} 196 ${T.y + 2}" stroke="#efe6d6" stroke-width="9" fill="none" stroke-linecap="round"/>`);
  if (T.collar) s.push(`<path d="M92 ${T.y} L112 ${T.y + 14} L120 ${T.y + 2} L128 ${T.y + 14} L148 ${T.y}" fill="${T.d}"/>`);
  s.push('</g>');

  /* ---- scarf ---- */
  if (has('scarf')) {
    s.push(`<g clip-path="url(#${uid}c)"><path d="M40 122 Q120 146 200 122 L200 140 Q120 164 40 140 Z" fill="#c23b3b"/><path d="M40 131 Q120 155 200 131" stroke="#f3e2c7" stroke-width="3" fill="none"/></g>
      <g transform="rotate(8 150 142)"><rect x="143" y="136" width="15" height="40" rx="3" fill="#c23b3b"/><rect x="143" y="150" width="15" height="3" fill="#f3e2c7"/><path d="M143 176 v6 M148 176 v6 M153 176 v6 M158 176 v6" stroke="#c23b3b" stroke-width="2"/></g>`);
  }

  /* ---- arms, sleeves, hands ---- */
  for (const side of ['L', 'R']) s.push(`<path d="${arms[side]}" fill="none" stroke="${KK.skin}" stroke-width="15" stroke-linecap="round"/>`);
  for (const side of ['L', 'R']) {
    const d = T.long ? arms[side] : upper[side];
    s.push(`<path d="${d}" fill="none" stroke="${T.c}" stroke-width="${T.puff ? 21 : 18}" stroke-linecap="${T.long ? 'butt' : 'round'}"/>`);
    if (T.long) { const [x, y] = side === 'L' ? [46, 186] : [194, 186]; s.push(`<ellipse cx="${x}" cy="${y}" rx="${T.puff ? 11 : 9.5}" ry="4" fill="${T.d}"/>`); }
  }
  for (const [x, flip] of [[46, 1], [194, -1]]) {
    if (has('gloves')) {
      s.push(`<g transform="translate(${x} 196) scale(${flip} 1)"><ellipse cx="0" cy="2" rx="10" ry="11" fill="#e9b949"/><ellipse cx="-9" cy="-2" rx="4" ry="6" fill="#e9b949"/><rect x="-10" y="-9" width="20" height="5" rx="2.5" fill="#c99a2a"/></g>`);
    } else {
      s.push(`<g transform="translate(${x} 194)" fill="${KK.skin}"><circle r="7"/><circle cx="-8" cy="5" r="4"/><circle cx="-3" cy="10" r="4"/><circle cx="3" cy="10" r="4"/><circle cx="8" cy="5" r="4"/></g>`);
    }
  }

  /* ---- head: hat, eyes, face ---- */
  if (has('hat')) {
    s.push('<path d="M72 84 C72 40 168 40 168 84 Z" fill="#7a3fa0"/><g stroke="#5d2e7c" stroke-width="2.5"><line x1="98" y1="78" x2="104" y2="52"/><line x1="120" y1="78" x2="120" y2="48"/><line x1="142" y1="78" x2="136" y2="52"/></g><rect x="68" y="72" width="104" height="15" rx="7.5" fill="#5d2e7c"/><circle cx="120" cy="45" r="10" fill="#f3e2c7"/>');
  }
  if (has('headband')) {
    s.push('<path d="M58 70 Q120 54 182 70 L182 82 Q120 66 58 82 Z" fill="#e0483e"/><path d="M58 76 Q120 60 182 76" stroke="#fff" stroke-width="2.5" fill="none"/>');
  }
  if (has('nightcap')) {
    s.push('<path d="M66 82 C70 30 150 18 200 56 C182 50 170 58 172 82 Z" fill="#5b6fb5"/><g fill="#f3e7c9" opacity=".9"><circle cx="110" cy="52" r="3"/><circle cx="140" cy="44" r="2.5"/><circle cx="160" cy="58" r="2.5"/></g><rect x="62" y="74" width="114" height="13" rx="6.5" fill="#f3e7c9"/><circle cx="202" cy="58" r="10" fill="#f3e7c9"/>');
  }
  // big glossy eyes, like the stuffy's glass ones
  for (const x of [82, 158]) {
    s.push(`<circle cx="${x}" cy="80" r="24" fill="url(#${uid}g)"/>
      <circle cx="${x}" cy="84" r="16" fill="#fffaf2"/>
      <circle cx="${x + 1}" cy="86" r="13" fill="${KK.iris}"/>
      <circle cx="${x + 1}" cy="87" r="8" fill="${KK.pupil}"/>
      <circle cx="${x + 6}" cy="80" r="4.5" fill="#fff"/><circle cx="${x - 4}" cy="92" r="2.2" fill="#fff" opacity=".9"/>`);
  }
  if ((scene.mood || '') === 'sleepy') {
    for (const x of [82, 158]) {
      s.push(`<path d="M${x - 17} 86 A17 17 0 0 1 ${x + 17} 86 Z" fill="${KK.skin}"/><path d="M${x - 15} 86 Q${x} 92 ${x + 15} 86" fill="none" stroke="${KK.line}" stroke-width="2.5" stroke-linecap="round"/>`);
    }
  }
  if (has('sun')) {
    s.push(`<g><path d="M102 82 Q120 76 138 82" stroke="#111" stroke-width="3.5" fill="none"/>
      <rect x="60" y="72" width="44" height="26" rx="12" fill="#151515"/><rect x="136" y="72" width="44" height="26" rx="12" fill="#151515"/>
      <path d="M68 79 l10 0 M144 79 l10 0" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/></g>`);
  }
  const mood = scene.mood || 'meh';
  const cheek = mood === 'cold' ? '#a9cdf0' : '#ff8fa3';
  s.push(`<g fill="${cheek}" opacity=".6"><ellipse cx="72" cy="112" rx="11" ry="6.5"/><ellipse cx="168" cy="112" rx="11" ry="6.5"/></g>`);
  s.push(`<circle cx="114" cy="104" r="1.5" fill="${KK.line}"/><circle cx="126" cy="104" r="1.5" fill="${KK.line}"/>`);
  if (mood === 'happy') {
    s.push(`<path d="M104 113 Q120 132 136 113 Z" fill="#6e2a36" stroke="${KK.line}" stroke-width="2.5" stroke-linejoin="round"/><path d="M112 122 Q120 117 128 122 Q120 129 112 122Z" fill="#e8798a"/>`);
  } else {
    const mouth = mood === 'cold' ? 'M107 118 q4.5 -3 9 0 t9 0 t9 0' : 'M107 115 Q120 125 133 115';
    s.push(`<path d="${mouth}" fill="none" stroke="${KK.line}" stroke-width="3" stroke-linecap="round"/>`);
  }
  if (has('mask')) s.push('<g><path d="M98 112 L72 104 M142 112 L168 104" stroke="#cfd9e0" stroke-width="2"/><rect x="96" y="100" width="48" height="28" rx="9" fill="#e6eef3"/><path d="M102 110 h36 M102 118 h36" stroke="#c5d1d9" stroke-width="1.5"/></g>');
  if (has('umbrella-maybe') && !umbrella) {
    // folded umbrella tucked under the arm
    s.push('<g transform="rotate(-28 200 170)"><rect x="196" y="140" width="9" height="50" rx="4" fill="#d6453d"/><path d="M200 190 v8 a4 4 0 0 1 -8 0" stroke="#3a2a1f" stroke-width="3" fill="none"/></g>');
  }
  s.push('</svg>');
  return s.join('');
}
