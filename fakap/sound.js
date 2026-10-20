// Звуки барабана для слайдов «Было: барабаны» и «Дошло до гендира».
// Если в public/fakap лежат baraban.mp3 (кручение) и bankrot.mp3 (сектор «Банкрот»), играют они.
// Иначе звук синтезируется: щелчки идут в такт анимации и замедляются вместе с ней.
// В baraban.mp3 первые 0.8 с тишина, её пропускаем, чтобы музыка начиналась вместе с барабаном.
// bankrot.mp3 вырезан из исходника с 0.7 с (3 с звука) и поднят по громкости до уровня baraban.mp3 (ffmpeg, +16 dB с лимитером).
// Подключается тегом <script type="module">: импорт JS из public Vite не пропускает.

let ctx = null
let master = null
let gen = 0
let timers = []
let players = []
const probed = {}

let last = null
const SPIN_SKIP = 0.8
const SPIN_VOLUME = 0.4
const BANKRUPT_VOLUME = 0.5
// Колесо на слайде «Дошло до гендира» встаёт через 3.6 с. Файл «Банкрота» стартует на 3.1 с раньше,
// через 0.5 с после клика, пока колесо крутится на полной скорости (автор просил начинать заранее)
const BANKRUPT_AT = 3.6
const BANKRUPT_LEAD = 3.1

function bez(p1, p2, s) {
  const u = 1 - s
  return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s
}

// Моменты, когда анимация с этим cubic-bezier проходит доли progress
function times(progress, [x1, y1, x2, y2], dur, delay) {
  return progress.map((target) => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2
      if (bez(y1, y2, m) < target) lo = m
      else hi = m
    }
    return delay + bez(x1, x2, (lo + hi) / 2) * dur
  })
}

async function has(name) {
  if (!(name in probed)) {
    probed[name] = fetch('/fakap-baraban/fakap/' + name, { method: 'HEAD' })
      .then(r => r.ok && (r.headers.get('content-type') || '').startsWith('audio'))
      .catch(() => false)
  }
  return probed[name]
}

function tick(a, t, freq, vol) {
  const len = 0.035
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * len), a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 4
  const src = a.createBufferSource()
  src.buffer = buf
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = 3
  const g = a.createGain()
  g.gain.value = vol
  src.connect(bp).connect(g).connect(master)
  src.start(t)
}

// Грустное «уа-уа-уа-уааа» на месте сектора «Банкрот»
function bankrupt(a, t0) {
  const notes = [[392, 0.32], [370, 0.32], [349, 0.32], [330, 1.1]]
  let t = t0
  notes.forEach(([f, d], i) => {
    const o = a.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(f, t)
    if (i === notes.length - 1) {
      const lfo = a.createOscillator()
      const depth = a.createGain()
      lfo.frequency.value = 6
      depth.gain.value = 8
      lfo.connect(depth).connect(o.frequency)
      lfo.start(t + 0.15)
      lfo.stop(t + d)
    }
    const lp = a.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1400
    const g = a.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.25, t + 0.04)
    g.gain.setValueAtTime(0.25, t + d - 0.08)
    g.gain.linearRampToValueAtTime(0, t + d)
    o.connect(lp).connect(g).connect(master)
    o.start(t)
    o.stop(t + d)
    t += d
  })
}

function playFile(name, at, skip = 0, volume = 1) {
  const el = new Audio('/fakap-baraban/fakap/' + name + (skip ? '#t=' + skip : ''))
  el.volume = volume
  players.push(el)
  timers.push(setTimeout(() => el.play().catch(() => {}), at * 1000))
}

function stop() {
  gen++
  timers.forEach(clearTimeout)
  timers = []
  players.forEach(el => el.pause())
  players = []
  if (master) {
    master.disconnect()
    master = null
  }
}

async function begin(names) {
  stop()
  const my = gen
  const found = await Promise.all(names.map(has))
  if (my !== gen) return null
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  if (my !== gen) return null
  master = ctx.createGain()
  master.gain.value = 0.8
  master.connect(ctx.destination)
  return { a: ctx, t0: ctx.currentTime, found }
}

// «Было: барабаны»: барабан проезжает 43 строки за 3.2 с после задержки 0.4 с
async function drum() {
  const s = await begin(['baraban.mp3'])
  if (!s) return
  if (s.found[0]) {
    playFile('baraban.mp3', 0, SPIN_SKIP, SPIN_VOLUME)
    last = { kind: 'drum', file: true }
    return
  }
  const rows = Array.from({ length: 43 }, (_, i) => (i + 1) / 43)
  const at = times(rows, [0.12, 0.6, 0.15, 1], 3.2, 0.4)
  at.forEach(t => tick(s.a, s.t0 + t, 3200, 0.5))
  last = { kind: 'drum', file: false, ticks: at.length, first: at[0], end: at[at.length - 1], ctx: s.a.state }
}

// «Дошло до гендира»: колесо крутится молча, bankrot.mp3 стартует через 0.5 с после клика и звучит около 3 с;
// синтез (если файла нет) играет после остановки колеса
async function wheel() {
  const s = await begin(['bankrot.mp3'])
  if (!s) return
  if (s.found[0]) playFile('bankrot.mp3', BANKRUPT_AT - BANKRUPT_LEAD, 0, BANKRUPT_VOLUME)
  else bankrupt(s.a, s.t0 + BANKRUPT_AT)
  last = { kind: 'wheel', bankFile: s.found[0], ctx: s.a.state }
}

window.fakapSound = { drum, wheel, stop, get last() { return last } }
