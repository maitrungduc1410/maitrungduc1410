// Everything the rendered SVGs say. Copy lives here, drawing lives in
// render.mjs. The wording follows ducmai.me so the two never drift apart.
//
// Card descriptions are pre-broken into lines on purpose: SVG text does not
// wrap, and a hand-picked break reads better than any width estimate.

export const PROFILE = {
  name: 'Duc Mai',
  headline: ['I work ', 'one layer below', '.'],
  eyebrow: 'Software engineer · TikTok Search · Singapore',
  focus: ['native', 'runtime', 'rendering'],
  site: 'ducmai.me',
  email: 'maitrungduc1410@gmail.com',
};

// One accent per layer, the dark palette of ducmai.me.
export const LAYERS = [
  { code: 'L0', name: 'UI surface', short: 'Surface', tech: 'pixels · gestures', color: '#ffb545' },
  { code: 'L1', name: 'TS · Lynx · React', short: 'Now', tech: 'components · bridges', color: '#4fd8ff' },
  { code: 'L2', name: 'Swift · Kotlin', short: 'Native', tech: 'views · threads', color: '#a98bff' },
  { code: 'L3', name: 'C · Rust → Wasm', short: 'Runtime', tech: 'syscalls · memory', color: '#5be49b' },
  { code: 'L4', name: 'GPU · rendering', short: 'Rendering', tech: 'vsync · budgets', color: '#ff6b6b' },
];

// `npm` is the package name when it differs from the repository name.
// `motif` picks the little animation drawn on the right of the card.
export const CARDS = [
  {
    repo: 'react-native-video-trim',
    layer: 2,
    motif: 'trim',
    lines: ['Frame-accurate video trimming for', 'React Native. When its ffmpeg-kit', 'was abandoned, I rebuilt that too.'],
  },
  {
    repo: 'react-native-loader-kit',
    layer: 2,
    motif: 'loaders',
    lines: ['30+ native loading indicators for', 'React Native, with speed control', 'and nothing on the JS thread.'],
  },
  {
    repo: 'react-native-shared-hero',
    layer: 2,
    motif: 'hero',
    lines: ['Shared-element transitions matched', 'by id, so any router works. Flights', 'run natively on Fabric.'],
  },
  {
    repo: 'react-native-signature-ink',
    layer: 2,
    motif: 'ink',
    lines: ['True-native signature capture.', 'Faster strokes draw thinner,', 'like a real pen.'],
  },
  {
    repo: 'react-native-waveform-player',
    layer: 2,
    motif: 'wave',
    lines: ['An audio waveform you can play', 'and scrub, native on iOS and', 'Android.'],
  },
  {
    repo: 'react-native-waveform-recorder',
    layer: 2,
    motif: 'record',
    lines: ['A high-performance audio recorder', 'for React Native, with a native', 'waveform that moves as you speak.'],
  },
  {
    repo: 'socket.io-mesh-adapter',
    layer: 3,
    motif: 'mesh',
    lines: ['Socket.IO without the broker: pods', 'talk in a mesh, zero broker hops.', 'Benchmarked at 300k connections.'],
  },
  {
    repo: 'node-scp-async',
    npm: 'node-scp',
    layer: 3,
    motif: 'scp',
    lines: ['Promise-based SCP for Node.js.', 'Six years old, still shipping,', 'and quietly load-bearing.'],
  },
  {
    repo: 'konva-inspector',
    layer: 4,
    motif: 'heatmap',
    lines: ['React DevTools for canvas apps:', 'scene graph, draw profiler and a', 'heatmap of what redraws most.'],
  },
  {
    repo: 'double-raf-demo',
    layer: 4,
    motif: 'frames',
    lines: ['Why one requestAnimationFrame', 'is not enough, shown frame', 'by frame.'],
  },
];

export const VIVARI = {
  repo: 'vivari',
  layer: 3,
  lines: ['Run Node, Bun and Python directly in your browser. No server, no install:', 'real npm packages and real dev servers, running entirely inside the tab.'],
  terminal: [
    { cmd: 'npm install' },
    { out: 'added 214 packages in 3.1s' },
    { cmd: 'npm run dev' },
    { out: 'VITE ready in 412 ms', accent: true },
    { out: '→ Local:  http://localhost:5173/' },
    { out: 'GET / 200 · served by this tab', dim: true },
  ],
};

export const AGENT_LOOP = {
  steps: ['plan', 'build', 'review', 'verify'],
  caption: 'The loop, not the hype: every step leaves an artefact the next one can check.',
};

// The command palette of ducmai.me, played back as a recording.
export const TERMINAL = [
  { cmd: 'whoami', out: ['Duc Mai · Software Engineer @ TikTok Search · Singapore'] },
  { cmd: 'layers', layers: true },
  {
    cmd: 'sudo hire me',
    out: ['[sudo] password for recruiter: ********', 'access granted.', `opening mailto:${PROFILE.email} …`],
  },
];