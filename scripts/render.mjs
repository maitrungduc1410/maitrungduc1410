#!/usr/bin/env node
// Renders every image on the profile, then README.md itself.
//
//   node scripts/render.mjs            fetch fresh numbers, fall back to data/stats.json
//   node scripts/render.mjs --offline  use data/stats.json only
//
// Inputs:  scripts/content.mjs (copy), fonts/*.woff2 (Geist, OFL), README.tmpl.md
//          and the public stats snapshot that ducmai.me refreshes every week.
// Outputs: assets/*.svg, data/stats.json, README.md.
//
// Each SVG is self-contained: Geist is subset to the exact characters that SVG
// draws and inlined, so viewing the profile fetches nothing from anyone. Motion
// is CSS keyframes, plus SMIL where something follows a path. Resting styles are
// always the final frame, so prefers-reduced-motion just switches animation off.
//
// Needs Node 20+ and Python 3 with fonttools and brotli.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_LOOP, CARDS, LAYERS, PROFILE, TERMINAL, VIVARI } from './content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATS_URL =
  process.env.STATS_URL ||
  'https://raw.githubusercontent.com/maitrungduc1410/my-portfolio/master/src/data/stats.snapshot.json';
const OFFLINE = process.argv.includes('--offline');

const C = {
  bg: '#0b0d12',
  term: '#07080b',
  bg2: '#131720',
  bg3: '#1d2230',
  line: '#262b36',
  line2: '#394050',
  ink: '#eef1f6',
  ink2: '#a9b1c0',
  ink3: '#7c8596',
};
const MONO = 0.6; // Geist Mono advance, in em

const STAR =
  'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z';
const DOWNLOAD =
  'M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (n) => Math.round(n * 100) / 100;
const kf = (frames) => frames.map(([p, css]) => `${typeof p === 'number' ? `${n2(p)}%` : p}{${css}}`).join('');

function compact(n) {
  const cut = (s) => s.replace(/\.?0+$/, '');
  if (n >= 1e6) return `${cut((n / 1e6).toFixed(2))}M`;
  if (n >= 1e5) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${cut((n / 1e3).toFixed(1))}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const FONT_FILES = { sans: 'Geist-Variable.woff2', mono: 'GeistMono-Variable.woff2' };
const fontCache = new Map();

function subsetFont(kind, chars) {
  const text = [...new Set([' ', ...chars])].sort().join('');
  const key = `${kind}\0${text}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const dir = mkdtempSync(join(tmpdir(), 'profile-font-'));
  try {
    writeFileSync(join(dir, 'text.txt'), text);
    execFileSync(
      'python3',
      [
        '-m', 'fontTools.subset', join(ROOT, 'fonts', FONT_FILES[kind]),
        `--text-file=${join(dir, 'text.txt')}`,
        `--output-file=${join(dir, 'out.woff2')}`,
        '--flavor=woff2', '--layout-features=kern', '--no-hinting', '--drop-tables+=meta,DSIG',
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const b64 = readFileSync(join(dir, 'out.woff2')).toString('base64');
    fontCache.set(key, b64);
    return b64;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// SVG builder
// ---------------------------------------------------------------------------

const BASE_CSS = [
  '.s{font-family:G,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '.m{font-family:GM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.fb{transform-box:fill-box;transform-origin:center}',
  '.fl{transform-box:fill-box;transform-origin:0 50%}',
  '.fr{transform-box:fill-box;transform-origin:100% 50%}',
  '.ft{transform-box:fill-box;transform-origin:0 0}',
  '@media (prefers-reduced-motion:reduce){*{animation:none!important}.motion{display:none}}',
].join('');

class Svg {
  constructor(w, h, title, desc) {
    Object.assign(this, { w, h, title, desc });
    this.css = [];
    this.defs = [];
    this.parts = [];
    this.used = { sans: new Set(), mono: new Set() };
    this.n = 0;
  }

  add(...markup) {
    this.parts.push(...markup);
  }

  def(markup) {
    this.defs.push(markup);
  }

  /** Registers a keyframe animation and returns the class that plays it. */
  anim(frames, spec) {
    const name = `a${++this.n}`;
    this.css.push(`@keyframes ${name}{${frames}}.${name}{animation:${name} ${spec}}`);
    return name;
  }

  /** Extra static CSS, returned class name included for convenience. */
  rule(css) {
    const name = `c${++this.n}`;
    this.css.push(`.${name}{${css}}`);
    return name;
  }

  /** `runs` is a string or a list of { t, fill?, attrs? } spans. */
  text(font, x, y, runs, attrs = '') {
    const list = typeof runs === 'string' ? [{ t: runs }] : runs;
    for (const r of list) for (const ch of r.t) this.used[font].add(ch);
    const inner = list
      .map((r) => (r.fill || r.attrs ? `<tspan${r.fill ? ` fill="${r.fill}"` : ''}${r.attrs ? ` ${r.attrs}` : ''}>${esc(r.t)}</tspan>` : esc(r.t)))
      .join('');
    return `<text class="${font === 'mono' ? 'm' : 's'}" x="${n2(x)}" y="${n2(y)}"${attrs ? ` ${attrs}` : ''}>${inner}</text>`;
  }

  toString() {
    const faces = [];
    for (const [kind, family] of [['sans', 'G'], ['mono', 'GM']]) {
      if (!this.used[kind].size) continue;
      faces.push(`@font-face{font-family:${family};src:url(data:font/woff2;base64,${subsetFont(kind, this.used[kind])}) format("woff2");font-weight:100 900}`);
    }
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" role="img" aria-labelledby="t d">`,
      `<title id="t">${esc(this.title)}</title>`,
      `<desc id="d">${esc(this.desc)}</desc>`,
      `<style>${faces.join('')}${BASE_CSS}${this.css.join('')}</style>`,
      this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '',
      ...this.parts,
      '</svg>',
      '',
    ]
      .filter((line, i, all) => line || i === all.length - 1)
      .join('\n');
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function panel(s, color, { gx = s.w - 60, gy = 30, gr = 260, rx = 14 } = {}) {
  s.def(
    `<radialGradient id="glow" cx="${gx}" cy="${gy}" r="${gr}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity=".16"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  s.add(
    `<rect x=".5" y=".5" width="${s.w - 1}" height="${s.h - 1}" rx="${rx}" fill="${C.bg}" stroke="${C.line}"/>`,
    `<rect x=".5" y=".5" width="${s.w - 1}" height="${s.h - 1}" rx="${rx}" fill="url(#glow)"/>`,
  );
}

function windowChrome(s, title) {
  s.add(
    `<g opacity=".85"><circle cx="24" cy="20" r="5.5" fill="#ff5f57"/><circle cx="44" cy="20" r="5.5" fill="#febc2e"/><circle cx="64" cy="20" r="5.5" fill="#28c840"/></g>`,
    s.text('mono', s.w / 2, 24, title, `text-anchor="middle" font-size="12" fill="${C.ink3}"`),
    `<line x1="1" y1="40.5" x2="${s.w - 1}" y2="40.5" stroke="${C.line}"/>`,
  );
}

function badge(s, x, y, layer) {
  const L = LAYERS[layer];
  return (
    `<rect x="${x}" y="${y}" width="30" height="20" rx="6" fill="${L.color}" fill-opacity=".12" stroke="${L.color}" stroke-opacity=".55"/>` +
    s.text('mono', x + 15, y + 14, L.code, `text-anchor="middle" font-size="11" font-weight="600" fill="${L.color}"`)
  );
}

/** Opacity window inside a loop: hidden, fades in at `on`, out at `off`. */
function loopShow(s, period, on, off, fade = 0.25) {
  const p = (t) => (Math.min(Math.max(t, 0), period) / period) * 100;
  return s.anim(
    kf([[0, 'opacity:0'], [p(on), 'opacity:0'], [p(on + fade), 'opacity:1'], [p(off), 'opacity:1'], [p(off + fade), 'opacity:0'], [100, 'opacity:0']]),
    `${period}s linear infinite`,
  );
}

/** A clip rect that types `chars` characters of width `w` inside a loop. */
function loopTypeClip(s, id, x, y, w, h, period, on, dur, chars) {
  const p = (t) => (t / period) * 100;
  const cls = s.anim(
    kf([[0, 'width:0'], [p(on), `width:0;animation-timing-function:steps(${chars},end)`], [p(on + dur), `width:${n2(w)}px`], [99.9, `width:${n2(w)}px`], [100, 'width:0']]),
    `${period}s linear infinite`,
  );
  s.def(`<clipPath id="${id}"><rect class="${cls}" x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${h}"/></clipPath>`);
}

/** Intro fade-and-rise, played once. */
function rise(s, delay, dy = 10) {
  return s.anim(`from{opacity:0;transform:translateY(${dy}px)}to{opacity:1;transform:none}`, `.7s cubic-bezier(.22,1,.36,1) ${delay}s both`);
}

/** A closed path through `points` with every corner rounded over `r` px of each edge. */
function roundedPath(points, r) {
  const n = points.length;
  const toward = ([x1, y1], [x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    return [n2(x1 + ((x2 - x1) * r) / len), n2(y1 + ((y2 - y1) * r) / len)];
  };
  let d = '';
  points.forEach((v, i) => {
    const a = toward(v, points[(i + n - 1) % n]);
    const b = toward(v, points[(i + 1) % n]);
    d += `${i ? 'L' : 'M'}${a} Q${v.map(n2)} ${b} `;
  });
  return `${d}Z`;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function hero() {
  const W = 840;
  const H = 380;
  const s = new Svg(
    W,
    H,
    `${PROFILE.name}: ${PROFILE.headline.join('')}`,
    `${PROFILE.eyebrow}. An animated stack of five layers, from the UI surface down to GPU rendering, with a probe diving through them.`,
  );
  panel(s, LAYERS[0].color, { gx: 720, gy: 50, gr: 380, rx: 16 });
  s.def(
    `<radialGradient id="glow2" cx="560" cy="400" r="320" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${LAYERS[2].color}" stop-opacity=".14"/><stop offset="1" stop-color="${LAYERS[2].color}" stop-opacity="0"/></radialGradient>` +
      `<pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#fff" fill-opacity=".08"/></pattern>` +
      `<radialGradient id="fade" cx="620" cy="210" r="250" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      `<mask id="dm"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>` +
      `<linearGradient id="hl" x1="118" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${LAYERS[0].color}"/><stop offset=".55" stop-color="${LAYERS[2].color}"/><stop offset="1" stop-color="${LAYERS[4].color}"/></linearGradient>` +
      `<filter id="soft" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="4"/></filter>`,
  );
  s.add(`<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="url(#glow2)"/>`);
  s.add(`<rect x="1" y="41" width="${W - 2}" height="${H - 42}" rx="15" fill="url(#dots)" mask="url(#dm)"/>`);
  windowChrome(s, 'dmos · ~/ducmai.me');

  // Left column: a typed prompt, then the name and the rest rise in.
  const prompt = '$ whoami';
  const pw = prompt.length * 15 * MONO;
  const typeCls = s.anim(`from{width:0}to{width:${pw}px}`, `.7s steps(${prompt.length},end) .3s both`);
  s.def(`<clipPath id="typed"><rect class="${typeCls}" x="40" y="72" width="${pw}" height="28"/></clipPath>`);
  s.add(
    `<g clip-path="url(#typed)">${s.text('mono', 40, 92, [{ t: '$ ', fill: LAYERS[0].color }, { t: 'whoami', fill: C.ink2 }], 'font-size="15"')}</g>`,
  );
  const hide = s.anim('from{opacity:0}to{opacity:0}', '1s both');
  const blink = s.anim('0%,50%{opacity:1}51%,100%{opacity:0}', '1.06s steps(1) 1s infinite');
  s.add(`<rect x="${40 + pw + 4}" y="78" width="9" height="18" rx="1" fill="${LAYERS[0].color}" style="animation:${hide} 1s both,${blink} 1.06s steps(1) 1s infinite"/>`);

  s.add(`<g class="${rise(s, 0.9)}">${s.text('sans', 38, 158, PROFILE.name, `font-size="50" font-weight="700" letter-spacing="-1.5" fill="${C.ink}"`)}</g>`);
  const [pre, mid, post] = PROFILE.headline;
  s.add(
    `<g class="${rise(s, 1.1)}">${s.text('sans', 40, 202, [{ t: pre }, { t: mid, fill: 'url(#hl)' }, { t: post }], `font-size="24" font-weight="500" letter-spacing="-.3" fill="${C.ink2}"`)}</g>`,
  );
  s.add(`<g class="${rise(s, 1.3)}">${s.text('mono', 40, 242, PROFILE.eyebrow, `font-size="13" fill="${C.ink3}"`)}</g>`);

  let cx = 40;
  PROFILE.focus.forEach((word, i) => {
    const color = LAYERS[i + 2].color;
    const w = word.length * 12 * MONO + 24;
    s.add(
      `<g class="${rise(s, 1.5 + i * 0.1, 6)}"><rect x="${n2(cx)}" y="266" width="${n2(w)}" height="26" rx="13" fill="${color}" fill-opacity=".1" stroke="${color}" stroke-opacity=".5"/>${s.text('mono', cx + w / 2, 283.5, word, `text-anchor="middle" font-size="12" fill="${color}"`)}</g>`,
    );
    cx += w + 8;
  });
  s.add(`<g class="${rise(s, 1.9, 4)}">${s.text('mono', 40, 342, [{ t: '→ ', fill: LAYERS[0].color }, { t: PROFILE.site, fill: C.ink2 }], 'font-size="13"')}</g>`);

  // Right column: the layer stack.
  const X = 610;
  const A = 105;
  const B = 52;
  const T = 9;
  const R = 16;
  const apex = (0.5 * R * A) / Math.hypot(A, B);
  const GAP = 44;
  const Y0 = 118;
  const cys = LAYERS.map((_, i) => Y0 + i * GAP);
  const probeFrom = 56;
  const probeTo = 364;
  const P = 6;
  const travel = 3.6;
  const loopDelay = 2;

  const slabs = [];
  const labels = [];
  LAYERS.forEach((L, i) => {
    const cy = cys[i];
    const corners = [[X, cy - B], [X + A, cy], [X, cy + B], [X - A, cy]];
    const top = roundedPath(corners, R);
    const bottom = roundedPath(corners.map(([x, y]) => [x, y + T]), R);
    const grid = [1 / 3, 2 / 3]
      .flatMap((f) => [
        [X + f * A, cy - B + f * B, X - A + f * A, cy + f * B],
        [X - f * A, cy - B + f * B, X + A - f * A, cy + f * B],
      ])
      .map(([x1, y1, x2, y2]) => `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}"/>`)
      .join('');
    const collapsed = (2 - i) * (GAP - 10);
    const explode = s.anim(`from{transform:translateY(${collapsed}px)}to{transform:none}`, `1.2s cubic-bezier(.22,1,.36,1) ${0.4 + i * 0.05}s both`);
    const hit = loopDelay + (travel * (cy - probeFrom)) / (probeTo - probeFrom);
    const pk = (t) => ((t - loopDelay) / P) * 100;
    const glow = s.anim(
      kf([[0, 'opacity:0'], [pk(hit - 0.25), 'opacity:0'], [pk(hit), 'opacity:.5'], [pk(hit + 0.9), 'opacity:0'], [100, 'opacity:0']]),
      `${P}s linear ${loopDelay}s infinite`,
    );
    const lit = s.anim(
      kf([[0, 'opacity:.6'], [pk(hit - 0.25), 'opacity:.6'], [pk(hit), 'opacity:1'], [pk(hit + 0.9), 'opacity:.6'], [100, 'opacity:.6']]),
      `${P}s linear ${loopDelay}s infinite`,
    );
    s.def(
      `<linearGradient id="side${i}" x1="${X - A}" y1="0" x2="${X + A}" y2="0" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="${L.color}" stop-opacity=".26"/><stop offset=".5" stop-color="${L.color}" stop-opacity=".16"/></linearGradient>`,
    );
    slabs.unshift(
      `<g class="${explode}">` +
        `<g fill="url(#side${i})"><path d="${bottom}"/><rect x="${n2(X - A + apex)}" y="${cy}" width="${n2(2 * (A - apex))}" height="${T}"/></g>` +
        `<path d="${top}" fill="${C.bg}" fill-opacity=".82"/>` +
        `<path d="${top}" fill="${L.color}" fill-opacity=".1" stroke="${L.color}" stroke-width="1.3"/>` +
        `<g stroke="${L.color}" stroke-opacity=".22">${grid}</g>` +
        `<path class="${glow}" d="${top}" fill="${L.color}" style="opacity:0"/>` +
        `</g>`,
    );
    const labelIn = s.anim('from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}', `.6s ease-out ${1.3 + i * 0.08}s both`);
    labels.push(
      `<g class="${labelIn}"><g class="${lit}">` +
        `<line x1="${n2(X + A - apex + 4)}" y1="${cy}" x2="${X + A + 14}" y2="${cy}" stroke="${L.color}" stroke-opacity=".6"/>` +
        s.text('mono', X + A + 20, cy + 4, [{ t: L.code, fill: L.color, attrs: 'font-weight="600"' }, { t: ` ${L.short}`, fill: C.ink2 }], 'font-size="11.5"') +
        `</g></g>`,
    );
  });

  const probe = s.anim(
    kf([
      [0, 'transform:translateY(0);opacity:0'],
      [4, 'opacity:1'],
      [((travel - 0.25) / P) * 100, 'opacity:1'],
      [(travel / P) * 100, `transform:translateY(${probeTo - probeFrom}px);opacity:0`],
      [100, `transform:translateY(${probeTo - probeFrom}px);opacity:0`],
    ]),
    `${P}s linear ${loopDelay}s infinite`,
  );
  const float = s.anim('0%,100%{transform:none}50%{transform:translateY(-5px)}', `8s ease-in-out ${loopDelay}s infinite`);
  s.add(
    `<g class="${float}">`,
    `<line x1="${X}" y1="${probeFrom}" x2="${X}" y2="${probeTo}" stroke="#fff" stroke-opacity=".07" stroke-dasharray="2 5"/>`,
    ...slabs,
    `<g class="motion ${probe}" style="opacity:0"><circle cx="${X}" cy="${probeFrom}" r="9" fill="#fff" opacity=".35" filter="url(#soft)"/><circle cx="${X}" cy="${probeFrom}" r="3" fill="#fff"/></g>`,
    `</g>`,
    ...labels,
  );
  return s;
}

// ---------------------------------------------------------------------------
// Layer navigation chips
// ---------------------------------------------------------------------------

function chip(i) {
  const L = LAYERS[i];
  const s = new Svg(160, 48, `${L.code} ${L.short}`, `Jump to ${L.code}, ${L.short}.`);
  panel(s, L.color, { gx: 26, gy: 24, gr: 90, rx: 12 });
  const ring = s.anim('0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(2.8);opacity:0}', `2.4s ease-out ${i * 0.3}s infinite`);
  const bob = s.anim('0%,100%{transform:none}50%{transform:translateY(3px)}', `1.6s ease-in-out ${i * 0.3}s infinite`);
  s.add(
    `<circle class="fb ${ring}" cx="24" cy="24" r="5" fill="none" stroke="${L.color}" stroke-width="1.5" style="opacity:0"/>`,
    `<circle cx="24" cy="24" r="4.5" fill="${L.color}"/>`,
    s.text('mono', 40, 28.5, L.code, `font-size="12" font-weight="600" fill="${L.color}"`),
    s.text('sans', 64, 29, L.short, `font-size="14" font-weight="500" fill="${C.ink}"`),
    `<g class="${bob}">${s.text('mono', 146, 29, '↓', `text-anchor="middle" font-size="13" fill="${C.ink3}"`)}</g>`,
  );
  return s;
}

// ---------------------------------------------------------------------------
// Card motifs, each drawn in a 120 x 118 box
// ---------------------------------------------------------------------------

const MOTIFS = {
  trim(s, c) {
    const P = 4;
    const frames = Array.from({ length: 6 }, (_, i) => {
      const x = i * 20;
      return `<rect x="${x}" y="30" width="20" height="46" fill="${i % 2 ? '#222838' : '#1b2030'}"/><path d="M${x + 3},70 l6,-11 4,6 3,-4 4,9z" fill="#3a4254"/>`;
    }).join('');
    const cover = kf([[0, 'transform:scaleX(0)'], [25, 'transform:scaleX(1)'], [80, 'transform:scaleX(1)'], [95, 'transform:scaleX(0)'], [100, 'transform:scaleX(0)']]);
    const shade = s.anim(cover, `${P}s cubic-bezier(.6,0,.3,1) infinite`);
    const edge = s.anim(kf([[0, 'transform:none'], [25, 'transform:scaleX(.5)'], [80, 'transform:scaleX(.5)'], [95, 'transform:none'], [100, 'transform:none']]), `${P}s cubic-bezier(.6,0,.3,1) infinite`);
    const left = s.anim(kf([[0, 'transform:none'], [25, 'transform:translateX(30px)'], [80, 'transform:translateX(30px)'], [95, 'transform:none'], [100, 'transform:none']]), `${P}s cubic-bezier(.6,0,.3,1) infinite`);
    const right = s.anim(kf([[0, 'transform:none'], [25, 'transform:translateX(-30px)'], [80, 'transform:translateX(-30px)'], [95, 'transform:none'], [100, 'transform:none']]), `${P}s cubic-bezier(.6,0,.3,1) infinite`);
    const head = s.anim(kf([[0, 'transform:none;opacity:0'], [27, 'transform:none;opacity:1'], [75, 'transform:translateX(60px);opacity:1'], [78, 'transform:translateX(60px);opacity:0'], [100, 'opacity:0']]), `${P}s linear infinite`);
    const handle = (x) => `<rect x="${x}" y="26" width="7" height="54" rx="2" fill="${c}"/><line x1="${x + 3.5}" y1="47" x2="${x + 3.5}" y2="59" stroke="${C.term}" stroke-width="1.5"/>`;
    return (
      `<g><rect x="0" y="30" width="120" height="46" rx="3" fill="#1b2030"/>${frames}` +
      `<g stroke="${C.term}" stroke-width="2" stroke-dasharray="2 3"><line x1="0" y1="33" x2="120" y2="33"/><line x1="0" y1="73" x2="120" y2="73"/></g></g>` +
      `<rect class="fl ${shade}" x="0" y="30" width="30" height="46" fill="${C.term}" fill-opacity=".72"/>` +
      `<rect class="fr ${shade}" x="90" y="30" width="30" height="46" fill="${C.term}" fill-opacity=".72"/>` +
      `<g class="fb ${edge}"><rect x="0" y="26" width="120" height="3" fill="${c}"/><rect x="0" y="77" width="120" height="3" fill="${c}"/></g>` +
      `<g class="${left}">${handle(0)}</g><g class="${right}">${handle(113)}</g>` +
      `<g class="${head}" style="opacity:0"><line x1="30" y1="22" x2="30" y2="84" stroke="#fff" stroke-width="1.5"/><circle cx="30" cy="22" r="2.5" fill="#fff"/></g>` +
      s.text('mono', 60, 104, '00:02 → 00:05', `text-anchor="middle" font-size="10" fill="${C.ink3}"`)
    );
  },

  loaders(s, c) {
    const cell = (x, y) => `<rect x="${x}" y="${y}" width="56" height="56" rx="10" fill="${C.bg2}" stroke="${C.line}"/>`;
    const pulse = kf([['0%,80%,100%', 'transform:scale(.35);opacity:.5'], [40, 'transform:scale(1);opacity:1']]);
    const dots = [16, 28, 40].map((x, i) => `<circle class="fb ${s.anim(pulse, `1.2s ease-in-out ${i * 0.16}s infinite`)}" cx="${x}" cy="28" r="4.5" fill="${c}"/>`).join('');
    const spin = s.anim('to{transform:rotate(360deg)}', '1s linear infinite');
    const bars = [12, 19, 26, 33, 40]
      .map((x, i) => `<rect class="fb ${s.anim(kf([['0%,100%', 'transform:scaleY(.35)'], [50, 'transform:scaleY(1)']]), `1s ease-in-out ${i * 0.1}s infinite`)}" x="${x}" y="78" width="4" height="24" rx="2" fill="${c}"/>`)
      .join('');
    const orbit = s.anim('to{transform:rotate(360deg)}', '1.6s linear infinite');
    return (
      cell(0, 0) + cell(64, 0) + cell(0, 62) + cell(64, 62) +
      dots +
      `<circle class="fb ${spin}" cx="92" cy="28" r="13" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="52 30"/>` +
      bars +
      `<circle cx="92" cy="90" r="13" fill="none" stroke="${C.line2}" stroke-dasharray="2 3"/><circle cx="92" cy="90" r="4" fill="${c}" fill-opacity=".5"/>` +
      `<g class="fb ${orbit}"><circle cx="92" cy="90" r="13" fill="none"/><circle cx="105" cy="90" r="3.5" fill="${c}"/></g>`
    );
  },

  hero(s, c) {
    const P = 4.4;
    const fly = s.anim(
      kf([[0, 'transform:none'], [12, 'transform:none;animation-timing-function:cubic-bezier(.3,0,.2,1)'], [30, 'transform:translate(-3px,-12px) scale(2.4,2.2)'], [70, 'transform:translate(-3px,-12px) scale(2.4,2.2);animation-timing-function:cubic-bezier(.3,0,.2,1)'], [88, 'transform:none'], [100, 'transform:none']]),
      `${P}s linear infinite`,
    );
    const others = s.anim(kf([[0, 'opacity:1'], [12, 'opacity:1'], [22, 'opacity:0'], [78, 'opacity:0'], [88, 'opacity:1'], [100, 'opacity:1']]), `${P}s linear infinite`);
    const detail = s.anim(kf([[0, 'opacity:0'], [26, 'opacity:0'], [34, 'opacity:1'], [66, 'opacity:1'], [72, 'opacity:0'], [100, 'opacity:0']]), `${P}s linear infinite`);
    const tile = (x, y) => `<rect x="${x}" y="${y}" width="20" height="20" rx="4" fill="#252c3b"/>`;
    return (
      `<rect x="32" y="4" width="56" height="110" rx="11" fill="${C.bg2}" stroke="${C.line2}"/>` +
      `<rect x="36" y="8" width="48" height="102" rx="8" fill="${C.term}"/>` +
      `<rect x="52" y="11" width="16" height="3" rx="1.5" fill="${C.line2}"/>` +
      `<g class="${detail}" style="opacity:0"><rect x="40" y="58" width="28" height="4" rx="2" fill="${C.ink3}"/><rect x="40" y="67" width="40" height="3" rx="1.5" fill="${C.line2}"/><rect x="40" y="74" width="34" height="3" rx="1.5" fill="${C.line2}"/><rect x="40" y="81" width="38" height="3" rx="1.5" fill="${C.line2}"/></g>` +
      `<g class="${others}">${tile(61, 20)}${tile(39, 44)}${tile(61, 44)}${tile(39, 68)}${tile(61, 68)}</g>` +
      `<rect class="ft ${fly}" x="39" y="20" width="20" height="20" rx="4" fill="${c}"/>`
    );
  },

  ink(s, c) {
    const d = 'M6,70 C12,48 18,34 24,44 C30,54 22,78 30,70 C38,62 40,40 46,46 C52,52 46,70 54,66 C62,62 64,44 70,50 C76,56 70,70 80,64 C90,58 92,40 98,44 C104,48 100,62 114,56';
    const draw = s.anim(
      kf([[0, 'stroke-dashoffset:100;opacity:1'], [50, 'stroke-dashoffset:0;opacity:1'], [82, 'stroke-dashoffset:0;opacity:1'], [94, 'stroke-dashoffset:0;opacity:0'], [100, 'stroke-dashoffset:100;opacity:0']]),
      '4s linear infinite',
    );
    return (
      `<line x1="0" y1="88" x2="120" y2="88" stroke="${C.line2}" stroke-dasharray="3 3"/>` +
      s.text('mono', 0, 84, 'x', `font-size="12" fill="${C.ink3}"`) +
      `<path class="${draw}" d="${d}" pathLength="100" stroke-dasharray="100" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle class="motion" r="2.6" fill="#fff"><animateMotion dur="4s" repeatCount="indefinite" calcMode="linear" keyPoints="0;1;1;1" keyTimes="0;.5;.94;1" path="${d}"/><animate attributeName="opacity" dur="4s" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;.5;.56;1"/></circle>` +
      s.text('mono', 120, 108, 'onDrawEnd()', `text-anchor="end" font-size="10" fill="${C.ink3}"`)
    );
  },

  wave(s, c) {
    const bars = Array.from({ length: 24 }, (_, i) => {
      const h = n2(8 + 30 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)) + 6 * Math.abs(Math.sin(i * 0.9)));
      return `<rect x="${1 + i * 5}" y="${n2(50 - h / 2)}" width="3" height="${h}" rx="1.5"/>`;
    }).join('');
    const progress = s.anim('from{width:0}to{width:120px}', '5s linear infinite');
    const head = s.anim('from{transform:none}to{transform:translateX(120px)}', '5s linear infinite');
    s.def(`<clipPath id="played"><rect class="${progress}" x="0" y="0" width="120" height="100"/></clipPath>`);
    return (
      `<g fill="${C.line2}">${bars}</g>` +
      `<g fill="${c}" clip-path="url(#played)">${bars}</g>` +
      `<line class="motion ${head}" x1="0" y1="20" x2="0" y2="80" stroke="#fff" stroke-width="1.5"/>` +
      `<circle cx="9" cy="102" r="9" fill="${c}"/><path d="M6.5,97.5 L13,102 L6.5,106.5z" fill="${C.term}"/>` +
      s.text('mono', 26, 106, '0:12 / 0:31', `font-size="10" fill="${C.ink3}"`)
    );
  },

  record(s, c) {
    const rec = '#ff6b6b';
    const pattern = Array.from({ length: 20 }, (_, i) => n2(6 + 34 * Math.abs(Math.sin(i * 0.9) * Math.sin(i * 0.37 + 1)) + 4 * Math.abs(Math.cos(i * 2.1))));
    const bars = [...pattern, ...pattern].map((h, i) => `<rect x="${1 + i * 5}" y="${n2(50 - h / 2)}" width="3" height="${h}" rx="1.5"/>`).join('');
    const scroll = s.anim('from{transform:none}to{transform:translateX(-100px)}', '4s linear infinite');
    const pulse = s.anim('0%,100%{opacity:1}50%{opacity:.25}', '1.2s ease-in-out infinite');
    s.def(
      `<linearGradient id="fadeIn" x1="0" y1="0" x2="34" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
        `<mask id="window" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="100"><rect x="0" y="8" width="101" height="84" fill="url(#fadeIn)"/></mask>`,
    );
    return (
      `<line x1="0" y1="50" x2="101" y2="50" stroke="${C.line2}" stroke-dasharray="2 3"/>` +
      `<g mask="url(#window)"><g class="${scroll}" fill="${c}">${bars}</g></g>` +
      `<line x1="104" y1="16" x2="104" y2="84" stroke="${rec}" stroke-width="1.5"/><circle cx="104" cy="16" r="3" fill="${rec}"/>` +
      `<circle class="${pulse}" cx="5" cy="102" r="4.5" fill="${rec}"/>` +
      s.text('mono', 15, 106, 'REC', `font-size="10" font-weight="600" fill="${rec}"`) +
      s.text('mono', 120, 106, '0:07', `text-anchor="end" font-size="10" fill="${C.ink3}"`)
    );
  },

  mesh(s, c) {
    const P = 3.2;
    const R = 40;
    const nodes = Array.from({ length: 6 }, (_, k) => {
      const a = ((-90 + k * 60) * Math.PI) / 180;
      return [n2(60 + R * Math.cos(a)), n2(52 + R * Math.sin(a))];
    });
    let edges = '';
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) edges += `<line x1="${nodes[i][0]}" y1="${nodes[i][1]}" x2="${nodes[j][0]}" y2="${nodes[j][1]}"/>`;
    const p = (t) => (t / P) * 100;
    const flashes = nodes.map(() => []);
    let packets = '';
    for (const [origin, start] of [[0, 0.15], [3, 1.75]]) {
      const end = start + 0.75;
      flashes[origin].push(start);
      nodes.forEach(([x, y], j) => {
        if (j === origin) return;
        flashes[j].push(end);
        const [ox, oy] = nodes[origin];
        const cls = s.anim(
          kf([[0, 'opacity:0;transform:none'], [p(start), 'opacity:1;transform:none;animation-timing-function:cubic-bezier(.4,0,.6,1)'], [p(end), `opacity:1;transform:translate(${n2(x - ox)}px,${n2(y - oy)}px)`], [p(end + 0.05), `opacity:0;transform:translate(${n2(x - ox)}px,${n2(y - oy)}px)`], [100, 'opacity:0']]),
          `${P}s linear infinite`,
        );
        packets += `<circle class="${cls}" cx="${ox}" cy="${oy}" r="2.6" fill="${c}" style="opacity:0"/>`;
      });
    }
    const dots = nodes
      .map(([x, y], j) => {
        const frames = [[0, 'opacity:0']];
        for (const t of flashes[j].sort((a, b) => a - b)) frames.push([p(t - 0.02), 'opacity:0'], [p(t + 0.05), 'opacity:.9'], [p(t + 0.5), 'opacity:0']);
        frames.push([100, 'opacity:0']);
        const cls = s.anim(kf(frames), `${P}s linear infinite`);
        return `<circle cx="${x}" cy="${y}" r="6" fill="${C.bg2}" stroke="${c}" stroke-width="1.5"/><circle class="${cls}" cx="${x}" cy="${y}" r="6" fill="${c}" style="opacity:0"/>`;
      })
      .join('');
    return (
      `<g stroke="${C.line2}" stroke-opacity=".8">${edges}</g>` +
      packets +
      dots +
      s.text('mono', 60, 112, '0 broker hops', `text-anchor="middle" font-size="10" fill="${C.ink3}"`)
    );
  },

  scp(s, c) {
    const P = 3.6;
    const packets = [0, 0.6, 1.2]
      .map((d) => {
        const cls = s.anim(kf([[0, 'opacity:0;transform:none'], [8, 'opacity:1'], [88, 'opacity:1'], [100, 'opacity:0;transform:translateX(34px)']]), `1.8s linear ${d}s infinite`);
        return `<rect class="${cls}" x="42" y="40" width="6" height="6" rx="1.5" fill="${c}" style="opacity:0"/>`;
      })
      .join('');
    const fill = s.anim(kf([[0, 'transform:scaleX(0)'], [75, 'transform:scaleX(1)'], [96, 'transform:scaleX(1)'], [100, 'transform:scaleX(0)']]), `${P}s cubic-bezier(.4,0,.6,1) infinite`);
    const done = s.anim(kf([[0, 'opacity:0'], [75, 'opacity:0'], [79, 'opacity:1'], [96, 'opacity:1'], [100, 'opacity:0']]), `${P}s linear infinite`);
    const led = (y, d) => `<circle class="${s.anim('0%,100%{opacity:.25}50%{opacity:1}', `.9s steps(2) ${d}s infinite`)}" cx="113" cy="${y}" r="1.6" fill="${c}"/>`;
    return (
      `<rect x="2" y="30" width="32" height="22" rx="3" fill="${C.bg2}" stroke="${C.line2}"/><path d="M-2,54 h40 l-3,4 h-34z" fill="${C.line2}"/>` +
      `<g fill="${C.bg2}" stroke="${C.line2}"><rect x="84" y="22" width="36" height="12" rx="2"/><rect x="84" y="37" width="36" height="12" rx="2"/><rect x="84" y="52" width="36" height="12" rx="2"/></g>` +
      led(28, 0) + led(43, 0.3) + led(58, 0.6) +
      `<line x1="40" y1="43" x2="80" y2="43" stroke="${C.line2}" stroke-dasharray="3 3"/>` +
      `<g fill="none" stroke="${C.ink3}" stroke-width="1.4"><path d="M57.5,25 v-3 a2.5,2.5 0 0 1 5,0 v3"/></g><rect x="55" y="25" width="10" height="8" rx="1.5" fill="${C.ink3}"/>` +
      packets +
      `<rect x="0" y="78" width="120" height="5" rx="2.5" fill="${C.bg3}"/><rect class="fl ${fill}" x="0" y="78" width="120" height="5" rx="2.5" fill="${c}"/>` +
      s.text('mono', 0, 102, 'uploadFile()', `font-size="10" fill="${C.ink3}"`) +
      `<path class="${done}" d="M106,97 l4,4 l8,-9" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  },

  heatmap(s, c) {
    s.def(`<linearGradient id="heat" x1="0" x2="1"><stop offset="0" stop-color="#4fd8ff"/><stop offset=".5" stop-color="#ffb545"/><stop offset="1" stop-color="#ff6b6b"/></linearGradient>`);
    const flash = (period) => s.anim(kf([[0, 'opacity:.85'], [55, 'opacity:.08'], [100, 'opacity:.08']]), `${period}s ease-out infinite`);
    const shapes = [
      [`<circle cx="20" cy="28" r="10"/>`, '#ff6b6b', 0.5],
      [`<rect x="38" y="16" width="30" height="20" rx="3"/>`, '#4fd8ff', 2.4],
      [`<path d="M8,82 L21,58 L34,82z"/>`, '#ffb545', 1.2],
      [`<rect x="44" y="54" width="26" height="28" rx="3"/>`, '#ff6b6b', 0.7],
    ];
    const rows = [16, 26, 36, 46, 56, 66, 76];
    const indent = [0, 4, 8, 8, 4, 8, 8];
    const select = s.anim(kf(rows.map((_, i) => [(i / rows.length) * 100, `transform:translateY(${(rows[i] - rows[0])}px)`]).concat([[100, 'transform:none']])), `${rows.length * 0.6}s steps(1) infinite`);
    return (
      `<rect x="0" y="6" width="78" height="86" rx="6" fill="${C.bg2}" stroke="${C.line}"/>` +
      shapes.map(([shape]) => shape.replace('/>', ` fill="#3a4254"/>`)).join('') +
      shapes.map(([shape, color, period]) => `<g class="${flash(period)}" fill="${color}">${shape}</g>`).join('') +
      `<rect x="84" y="6" width="36" height="86" rx="6" fill="${C.bg2}" stroke="${C.line}"/>` +
      `<rect class="${select}" x="86" y="${rows[0] - 4}" width="32" height="8" rx="2" fill="${c}" fill-opacity=".3"/>` +
      rows.map((y, i) => `<rect x="${89 + indent[i]}" y="${y - 1.5}" width="${22 - indent[i]}" height="3" rx="1.5" fill="${C.line2}"/>`).join('') +
      `<rect x="0" y="100" width="120" height="4" rx="2" fill="url(#heat)"/>` +
      s.text('mono', 0, 115, 'cold', `font-size="9" fill="${C.ink3}"`) +
      s.text('mono', 120, 115, 'hot', `text-anchor="end" font-size="9" fill="${C.ink3}"`)
    );
  },

  frames(s, c) {
    const P = 3;
    const jump = s.anim(kf([[0, 'transform:none'], [30, 'transform:none;animation-timing-function:steps(1,start)'], [31, 'transform:translateX(96px)'], [90, 'transform:translateX(96px);animation-timing-function:steps(1,start)'], [91, 'transform:none'], [100, 'transform:none']]), `${P}s linear infinite`);
    const glide = s.anim(kf([[0, 'transform:none'], [40, 'transform:none;animation-timing-function:cubic-bezier(.4,0,.2,1)'], [80, 'transform:translateX(96px)'], [90, 'transform:translateX(96px);animation-timing-function:steps(1,start)'], [91, 'transform:none'], [100, 'transform:none']]), `${P}s linear infinite`);
    const scan = s.anim('from{transform:none}to{transform:translateX(120px)}', `${P}s linear infinite`);
    return (
      `<g stroke="${C.line2}" stroke-dasharray="2 3">${[0, 30, 60, 90, 120].map((x) => `<line x1="${x}" y1="14" x2="${x}" y2="92"/>`).join('')}</g>` +
      s.text('mono', 15, 9, '16.7ms', `text-anchor="middle" font-size="9" fill="${C.ink3}"`) +
      s.text('mono', 3, 30, '1× rAF', `font-size="10" fill="${C.ink3}"`) +
      `<circle class="${jump}" cx="12" cy="44" r="5.5" fill="${C.ink3}"/>` +
      s.text('mono', 3, 70, '2× rAF', `font-size="10" fill="${c}"`) +
      `<circle class="${glide}" cx="12" cy="84" r="5.5" fill="${c}"/>` +
      `<line class="motion ${scan}" x1="0" y1="14" x2="0" y2="92" stroke="#fff" stroke-opacity=".35"/>` +
      s.text('mono', 60, 110, 'jumps vs. animates', `text-anchor="middle" font-size="10" fill="${C.ink3}"`)
    );
  },
};

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function footer(s, x, y, repo, npm, stats) {
  const parts = [];
  const stars = stats.github.stars[repo];
  const installs = stats.npm.downloads[npm ?? repo];
  if (stars != null) {
    const t = compact(stars);
    parts.push(`<path transform="translate(${x} ${y - 10.5}) scale(.75)" d="${STAR}" fill="#e3b341"/>`, s.text('mono', x + 17, y, t, `font-size="12" fill="${C.ink2}"`));
    x += 17 + t.length * 12 * MONO + 16;
  }
  if (installs != null) {
    const t = `${compact(installs)}/mo`;
    parts.push(`<path transform="translate(${n2(x)} ${y - 10.5}) scale(.75)" d="${DOWNLOAD}" fill="${C.ink3}"/>`, s.text('mono', x + 17, y, t, `font-size="12" fill="${C.ink2}"`));
  }
  return parts.join('');
}

function card(spec, stats) {
  const L = LAYERS[spec.layer];
  const W = 410;
  const H = 210;
  const s = new Svg(W, H, spec.repo, spec.lines.join(' '));
  panel(s, L.color, { gx: W - 70, gy: 60, gr: 230 });
  s.add(
    badge(s, 20, 20, spec.layer),
    s.text('mono', 60, 35, spec.repo, `font-size="14" font-weight="600" fill="${C.ink}"`),
    s.text('mono', W - 20, 35, '↗', `text-anchor="end" font-size="13" fill="${C.ink3}"`),
    ...spec.lines.map((line, i) => s.text('sans', 20, 78 + i * 21, line, `font-size="13.5" fill="${C.ink2}"`)),
    footer(s, 20, 184, spec.repo, spec.npm, stats) || s.text('mono', 20, 184, 'demo · source on GitHub', `font-size="12" fill="${C.ink3}"`),
    `<g transform="translate(270 58)">${MOTIFS[spec.motif](s, L.color)}</g>`,
  );
  return s;
}

// ---------------------------------------------------------------------------
// vivari feature
// ---------------------------------------------------------------------------

function vivari(stats) {
  const L = LAYERS[VIVARI.layer];
  const W = 840;
  const H = 310;
  const P = 12;
  const s = new Svg(W, H, 'vivari', `${VIVARI.lines.join(' ')} An animated terminal installs packages and starts a dev server, and the preview renders in the same tab.`);
  panel(s, L.color, { gx: W - 120, gy: 40, gr: 420, rx: 16 });
  const stars = compact(stats.github.stars[VIVARI.repo]);
  const mit = 136 + 17 + stars.length * 12 * MONO + 14;
  s.add(
    badge(s, 24, 22, VIVARI.layer),
    s.text('mono', 64, 37, VIVARI.repo, `font-size="16" font-weight="600" fill="${C.ink}"`),
    `<path transform="translate(136 26.5) scale(.75)" d="${STAR}" fill="#e3b341"/>`,
    s.text('mono', 153, 37, stars, `font-size="12" fill="${C.ink2}"`),
    `<rect x="${n2(mit)}" y="24" width="36" height="18" rx="9" fill="none" stroke="${C.line2}"/>`,
    s.text('mono', mit + 18, 37, 'MIT', `text-anchor="middle" font-size="10.5" fill="${C.ink2}"`),
    s.text('mono', W - 24, 37, [{ t: 'vivari.run ', fill: C.ink2 }, { t: '↗' }], `text-anchor="end" font-size="12.5" fill="${C.ink3}"`),
    ...VIVARI.lines.map((line, i) => s.text('sans', 24, 72 + i * 21, line, `font-size="14" fill="${C.ink2}"`)),
  );

  // Terminal
  const tx = 24;
  const ty = 112;
  const tw = 388;
  const th = 176;
  s.add(
    `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="10" fill="${C.term}" stroke="${C.line}"/>`,
    `<g opacity=".7"><circle cx="${tx + 16}" cy="${ty + 14}" r="4" fill="#ff5f57"/><circle cx="${tx + 30}" cy="${ty + 14}" r="4" fill="#febc2e"/><circle cx="${tx + 44}" cy="${ty + 14}" r="4" fill="#28c840"/></g>`,
    s.text('mono', tx + tw / 2, ty + 18, 'zsh · ~/app', `text-anchor="middle" font-size="10.5" fill="${C.ink3}"`),
  );
  const times = [0.4, 1.5, 2.1, 3.1, 3.5, 5.2];
  const fs = 12.5;
  VIVARI.terminal.forEach((line, i) => {
    const y = ty + 50 + i * 22;
    const on = times[i];
    const off = P - 0.8;
    if (line.cmd) {
      const t = `$ ${line.cmd}`;
      loopTypeClip(s, `ty${i}`, tx + 16, y - 14, t.length * fs * MONO, 20, P, on, 0.6, t.length);
      s.add(`<g clip-path="url(#ty${i})"><g class="${loopShow(s, P, 0, off)}">${s.text('mono', tx + 16, y, [{ t: '$ ', fill: L.color }, { t: line.cmd, fill: C.ink }], `font-size="${fs}"`)}</g></g>`);
    } else {
      const fill = line.accent ? L.color : line.dim ? C.ink3 : C.ink2;
      s.add(`<g class="${loopShow(s, P, on, off, 0.15)}">${s.text('mono', tx + 16, y, line.out, `font-size="${fs}" fill="${fill}"`)}</g>`);
    }
  });

  // Browser preview
  const bx = 428;
  const bw = 388;
  s.add(
    `<rect x="${bx}" y="${ty}" width="${bw}" height="${th}" rx="10" fill="${C.bg2}" stroke="${C.line}"/>`,
    `<g opacity=".7"><circle cx="${bx + 16}" cy="${ty + 14}" r="4" fill="${C.line2}"/><circle cx="${bx + 30}" cy="${ty + 14}" r="4" fill="${C.line2}"/><circle cx="${bx + 44}" cy="${ty + 14}" r="4" fill="${C.line2}"/></g>`,
    `<rect x="${bx + 60}" y="${ty + 5}" width="${bw - 76}" height="18" rx="6" fill="${C.term}" stroke="${C.line}"/>`,
    s.text('mono', bx + 72, ty + 18, 'localhost:5173', `font-size="11" fill="${C.ink2}"`),
    `<line x1="${bx + 1}" y1="${ty + 28.5}" x2="${bx + bw - 1}" y2="${ty + 28.5}" stroke="${C.line}"/>`,
  );
  const shimmer = s.anim('0%,100%{opacity:.35}50%{opacity:.8}', '1.2s ease-in-out infinite');
  s.add(
    `<g class="${loopShow(s, P, 0, 3.7, 0.2)}" style="opacity:0"><g class="${shimmer}" fill="${C.bg3}"><rect x="${bx + 24}" y="${ty + 52}" width="200" height="16" rx="4"/><rect x="${bx + 24}" y="${ty + 78}" width="150" height="9" rx="4"/><rect x="${bx + 24}" y="${ty + 100}" width="110" height="28" rx="8"/></g></g>`,
  );
  const page = loopShow(s, P, 3.7, P - 0.8, 0.3);
  const counts = [0, 1, 2, 3];
  const clickAt = [4.6, 5.8, 7, 8.2];
  const countMarkup = counts
    .map((n, i) => {
      const from = i === 0 ? 3.7 : clickAt[i];
      const to = i === counts.length - 1 ? P - 0.8 : clickAt[i + 1];
      return `<g class="${loopShow(s, P, from, to - 0.05, 0.05)}"${i === counts.length - 1 ? '' : ' style="opacity:0"'}>${s.text('mono', bx + 79, ty + 119, `count is ${n}`, `text-anchor="middle" font-size="12" fill="${C.ink}"`)}</g>`;
    })
    .join('');
  const press = s.anim(
    kf([[0, 'transform:none'], ...clickAt.slice(1).flatMap((t) => [[((t - 0.12) / P) * 100, 'transform:none'], [(t / P) * 100, 'transform:scale(.94)'], [((t + 0.14) / P) * 100, 'transform:none']]), [100, 'transform:none']]),
    `${P}s linear infinite`,
  );
  s.add(
    `<g class="${page}">`,
    s.text('sans', bx + 24, ty + 66, 'Hello from your tab', `font-size="20" font-weight="600" letter-spacing="-.3" fill="${C.ink}"`),
    s.text('sans', bx + 24, ty + 87, 'Edit src/App.jsx and the preview updates.', `font-size="12" fill="${C.ink3}"`),
    `<rect class="fb ${press}" x="${bx + 24}" y="${ty + 100}" width="110" height="28" rx="8" fill="${L.color}" fill-opacity=".12" stroke="${L.color}" stroke-opacity=".6"/>`,
    countMarkup,
    `<circle cx="${bx + 24}" cy="${ty + 152}" r="3.5" fill="${L.color}"/>`,
    s.text('mono', bx + 34, ty + 156, [{ t: 'servers used: ', fill: C.ink3 }, { t: '0', fill: L.color, attrs: 'font-weight="600"' }], 'font-size="11.5"'),
    `</g>`,
  );
  return s;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function numbers(stats) {
  const installs = Object.values(stats.npm.downloads).reduce((a, b) => a + b, 0);
  const stars = Object.values(stats.github.stars).reduce((a, b) => a + b, 0);
  const items = [
    { v: compact(installs), label: 'npm installs a month', color: LAYERS[2].color },
    { v: compact(stars), label: 'stars on these projects', color: '#e3b341' },
    { v: compact(stats.github.followers), label: 'GitHub followers', color: LAYERS[1].color },
    { v: compact(stats.viblo.views), label: 'article views on Viblo', color: LAYERS[3].color },
  ];
  const W = 840;
  const H = 140;
  const s = new Svg(W, H, 'By the numbers', items.map((i) => `${i.v} ${i.label}`).join(', ') + '.');
  panel(s, LAYERS[0].color, { gx: 120, gy: 0, gr: 420 });
  const col = W / items.length;
  const size = 36;
  const lh = 44;
  const base = 76;
  const cw = size * MONO;
  items.forEach((item, c) => {
    const x0 = c * col + 28;
    if (c) s.add(`<line x1="${c * col}" y1="24" x2="${c * col}" y2="${H - 24}" stroke="${C.line}"/>`);
    s.add(`<rect x="${x0}" y="26" width="22" height="3" rx="1.5" fill="${item.color}"/>`);
    s.def(`<clipPath id="win${c}"><rect x="${x0 - 2}" y="${base - size}" width="${item.v.length * cw + 4}" height="${lh}"/></clipPath>`);
    const glyphs = [...item.v].map((ch, i) => {
      const x = x0 + i * cw;
      if (!/\d/.test(ch)) return s.text('mono', x, base, ch, `font-size="${size}" font-weight="600" fill="${C.ink2}"`);
      const stop = (10 + Number(ch)) * lh;
      const roll = s.anim(`from{transform:none}`, `${1.4 + i * 0.12}s cubic-bezier(.2,.8,.2,1) ${0.3 + c * 0.15}s both`);
      const rest = s.rule(`transform:translateY(-${stop}px)`);
      const strip = Array.from({ length: 20 }, (_, k) => s.text('mono', x, base + k * lh, String(k % 10), `font-size="${size}" font-weight="600" fill="${C.ink}"`)).join('');
      return `<g class="${rest} ${roll}">${strip}</g>`;
    });
    s.add(`<g clip-path="url(#win${c})">${glyphs.join('')}</g>`);
    s.add(s.text('sans', x0, 110, item.label, `font-size="13" fill="${C.ink3}"`));
  });
  return s;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

function agentLoop() {
  const L = LAYERS[1];
  const W = 840;
  const H = 170;
  const P = 6;
  const s = new Svg(W, H, 'The agent loop', `${AGENT_LOOP.steps.join(', then ')}, and around again. ${AGENT_LOOP.caption}`);
  panel(s, L.color, { gx: 420, gy: 0, gr: 460 });
  const xs = [150, 330, 510, 690];
  const y = 66;
  const pw = 116;
  const artefacts = ['spec', 'diff', 'notes'];
  const track = `M${xs[0]},${y} H${xs[3]} V${y + 46} Q${xs[3]},${y + 56} ${xs[3] - 10},${y + 56} H${xs[0] + 10} Q${xs[0]},${y + 56} ${xs[0]},${y + 46} Z`;
  const total = 540 + 46 + 15.7 + 520 + 15.7 + 46;
  s.def(`<filter id="soft" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="3"/></filter>`);
  s.add(`<path d="${track}" fill="none" stroke="${L.color}" stroke-opacity=".25" stroke-dasharray="3 5"/>`);
  artefacts.forEach((a, i) => s.add(s.text('mono', (xs[i] + xs[i + 1]) / 2, y - 8, a, `text-anchor="middle" font-size="10.5" fill="${C.ink3}"`)));
  s.add(s.text('mono', 420, y + 52, 'device log', `text-anchor="middle" font-size="10.5" fill="${C.ink3}"`));
  s.add(
    `<g class="motion"><circle r="8" fill="${L.color}" opacity=".5" filter="url(#soft)"/><circle r="3.5" fill="#fff"/><animateMotion dur="${P}s" repeatCount="indefinite" path="${track}"/></g>`,
  );
  AGENT_LOOP.steps.forEach((step, i) => {
    const x = xs[i];
    const at = (P * (x - xs[0])) / total;
    const p = (t) => (t / P) * 100;
    const frames =
      i === 0
        ? [[0, 'opacity:1'], [p(0.7), 'opacity:0'], [p(P - 0.25), 'opacity:0'], [100, 'opacity:1']]
        : [[0, 'opacity:0'], [p(at - 0.2), 'opacity:0'], [p(at + 0.05), 'opacity:1'], [p(at + 0.7), 'opacity:0'], [100, 'opacity:0']];
    const lit = s.anim(kf(frames), `${P}s linear infinite`);
    s.add(
      s.text('mono', x, y - 32, `0${i + 1}`, `text-anchor="middle" font-size="10" fill="${C.ink3}"`),
      `<rect x="${x - pw / 2}" y="${y - 19}" width="${pw}" height="38" rx="19" fill="${C.bg2}" stroke="${C.line2}"/>`,
      `<rect class="${lit}" x="${x - pw / 2}" y="${y - 19}" width="${pw}" height="38" rx="19" fill="${L.color}" fill-opacity=".14" stroke="${L.color}" style="opacity:0"/>`,
      s.text('mono', x, y + 4.5, step, `text-anchor="middle" font-size="13" font-weight="500" fill="${C.ink}"`),
    );
  });
  s.add(s.text('sans', 420, H - 16, AGENT_LOOP.caption, `text-anchor="middle" font-size="12.5" fill="${C.ink3}"`));
  return s;
}

// ---------------------------------------------------------------------------
// Terminal recording
// ---------------------------------------------------------------------------

function terminal() {
  const W = 840;
  const H = 400;
  const P = 16;
  const off = P - 1;
  const fs = 13;
  const lh = 21;
  const x = 28;
  const cw = fs * MONO;
  const s = new Svg(W, H, 'DmOS terminal', `A replay of the ducmai.me command palette: ${TERMINAL.map((t) => t.cmd).join(', ')}.`);
  panel(s, LAYERS[0].color, { gx: 700, gy: 40, gr: 420, rx: 16 });
  windowChrome(s, 'dmos · zsh');
  let y = 74;
  let t = 0.3;
  let n = 0;
  const show = (at, markup, fade = 0.12) => s.add(`<g class="${loopShow(s, P, at, off, fade)}">${markup}</g>`);
  show(t, s.text('mono', x, y, 'DmOS 2.0 · type help for commands', `font-size="${fs}" fill="${C.ink3}"`));
  for (const step of TERMINAL) {
    y += lh + 6;
    t += 0.7;
    const line = `$ ${step.cmd}`;
    const dur = 0.07 * step.cmd.length + 0.15;
    loopTypeClip(s, `c${n}`, x, y - 15, line.length * cw, 21, P, t, dur, line.length);
    s.add(`<g clip-path="url(#c${n++})"><g class="${loopShow(s, P, 0, off)}">${s.text('mono', x, y, [{ t: '$ ', fill: LAYERS[0].color }, { t: step.cmd, fill: C.ink }], `font-size="${fs}"`)}</g></g>`);
    t += dur + 0.35;
    if (step.layers) {
      LAYERS.forEach((L) => {
        y += lh;
        show(t, s.text('mono', x, y, [{ t: L.code, fill: L.color, attrs: 'font-weight="600"' }, { t: L.name, fill: C.ink, attrs: `x="${x + 44}"` }, { t: L.tech, fill: C.ink3, attrs: `x="${x + 250}"` }], `font-size="${fs}"`));
        t += 0.12;
      });
      continue;
    }
    step.out.forEach((out, i) => {
      y += lh;
      if (out.startsWith('[sudo]')) {
        const [prefix, stars] = out.split(': ');
        show(t, s.text('mono', x, y, `${prefix}: `, `font-size="${fs}" fill="${C.ink2}"`));
        const sx = x + (prefix.length + 2) * cw;
        loopTypeClip(s, `c${n}`, sx, y - 15, stars.length * cw, 21, P, t + 0.4, 0.8, stars.length);
        s.add(`<g clip-path="url(#c${n++})"><g class="${loopShow(s, P, 0, off)}">${s.text('mono', sx, y, stars, `font-size="${fs}" fill="${C.ink2}"`)}</g></g>`);
        t += 1.6;
      } else if (out === 'access granted.') {
        show(t, `<path d="M${x + 1},${y - 5} l3.5,3.5 l6.5,-8" fill="none" stroke="${LAYERS[3].color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` + s.text('mono', x + 18, y, out, `font-size="${fs}" fill="${LAYERS[3].color}"`));
        t += 0.5;
      } else {
        show(t, s.text('mono', x, y, out, `font-size="${fs}" fill="${C.ink2}"`));
        t += i === step.out.length - 1 ? 0.2 : 0.5;
      }
    });
  }
  y += lh + 6;
  t += 0.5;
  const blink = s.anim('0%,50%{opacity:1}51%,100%{opacity:0}', '1.06s steps(1) infinite');
  show(t, s.text('mono', x, y, '$ ', `font-size="${fs}" fill="${LAYERS[0].color}"`) + `<rect class="${blink}" x="${x + 2 * cw + 2}" y="${y - 13}" width="8" height="16" rx="1" fill="${LAYERS[0].color}"/>`);
  if (y + 24 > H) throw new Error(`terminal.svg overflows: last line at ${y}`);
  return s;
}

// ---------------------------------------------------------------------------
// Stats and README
// ---------------------------------------------------------------------------

function validStats(s) {
  return (
    s && typeof s.asOf === 'string' &&
    s.github && Number.isFinite(s.github.followers) && s.github.stars && typeof s.github.stars === 'object' &&
    s.npm && s.npm.downloads && typeof s.npm.downloads === 'object' &&
    s.viblo && Number.isFinite(s.viblo.views)
  );
}

async function loadStats() {
  const local = join(ROOT, 'data', 'stats.json');
  if (!OFFLINE) {
    try {
      const res = await fetch(STATS_URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = await res.json();
      if (!validStats(fresh)) throw new Error('unexpected shape');
      writeFileSync(local, `${JSON.stringify(fresh, null, 2)}\n`);
      return fresh;
    } catch (err) {
      console.log(`::warning::Stats snapshot unavailable (${err.message}); using the committed data/stats.json.`);
    }
  }
  const saved = JSON.parse(readFileSync(local, 'utf8'));
  if (!validStats(saved)) throw new Error('data/stats.json has an unexpected shape');
  return saved;
}

function renderReadme(stats) {
  const tmpl = readFileSync(join(ROOT, 'README.tmpl.md'), 'utf8');
  const body = tmpl.replace(/\{\{(\w+)(?::([\w.-]+))?\}\}/g, (match, kind, key) => {
    const value = kind === 'asOf' ? stats.asOf : kind === 'stars' ? stats.github.stars[key] : kind === 'installs' ? stats.npm.downloads[key] : undefined;
    if (value == null) throw new Error(`README.tmpl.md: no value for ${match}`);
    return typeof value === 'number' ? compact(value) : value;
  });
  return ['<!-- AUTOGENERATED FILE - DO NOT EDIT. -->', '<!-- Edit README.tmpl.md; scripts/render.mjs regenerates this file. -->', '', body].join('\n');
}

const stats = await loadStats();
const files = new Map([
  ['hero.svg', hero()],
  ...LAYERS.map((_, i) => [`nav-l${i}.svg`, chip(i)]),
  ['numbers.svg', numbers(stats)],
  ['loop.svg', agentLoop()],
  ['vivari.svg', vivari(stats)],
  ...CARDS.map((spec) => [`card-${spec.repo}.svg`, card(spec, stats)]),
  ['terminal.svg', terminal()],
]);
for (const [name, svg] of files) {
  const out = String(svg);
  writeFileSync(join(ROOT, 'assets', name), out);
  console.log(`assets/${name.padEnd(40)} ${(out.length / 1024).toFixed(1)} KB`);
}
writeFileSync(join(ROOT, 'README.md'), renderReadme(stats));
console.log('README.md');