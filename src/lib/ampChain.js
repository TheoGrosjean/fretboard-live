/**
 * Mini simulateur d'ampli guitare en Web Audio.
 *
 * entrée → noise gate → préampli (filtres + deux triodes) → égaliseur Bass / Mid / Treble / Presence
 *        → étage de puissance (sag) → baffle (réponse impulsionnelle, voir lib/cabinets.js) → master → limiteur → sortie,
 *        avec reverb et delay en parallèle après le master.
 *
 * Les lampes sont calculées dans un AudioWorklet (voir lib/ampWorklet.js) ; sans AudioWorklet, une simple
 * courbe de saturation prend le relais.
 *
 * Tous les réglages vont de 0 à 10, comme sur un vrai ampli (5 = neutre pour l'égaliseur).
 */

export const PRESETS = {
  clean: { gain: 1.5, bass: 5.5, mid: 5, treble: 6.5, presence: 6, master: 7.5, reverb: 3.5, delay: 2, gate: 2 },
  crunch: { gain: 6, bass: 5, mid: 7, treble: 6.5, presence: 6.5, master: 7, reverb: 2, delay: 0, gate: 3 },
  lead: { gain: 8, bass: 5, mid: 7, treble: 6, presence: 6.5, master: 6.5, reverb: 3, delay: 3.5, gate: 4 },
}
export const DEFAULT_PRESET = 'crunch'

import { DEFAULT_CABINET, cabinetImpulse } from './cabinets.js'
import workletUrl from './ampWorklet.js?url'

const DRIVE_HEADROOM = 8 // la courbe de saturation couvre ±8 : le signal y entre divisé d'autant
const DELAY_TIME = 0.38 // s
const DELAY_FEEDBACK = 0.35

const dbToGain = (db) => 10 ** (db / 20)
/** Réglage 0–10 → gain en dB d'un étage d'égaliseur (5 = 0 dB). */
const eqDb = (v, range = 12) => ((v - 5) / 5) * range

const SAG = 0.3 // affaissement de l'alimentation de l'étage de puissance
const POWER_DRIVE = 0.6 // l'étage de puissance ne sature que sur les attaques fortes
const TUBES_MAKEUP_DB = 4 // les lampes (filtres internes, sag) sortent un peu moins fort que la simple courbe

/** Charge les lampes (une fois par contexte audio) ; false si le navigateur ne sait pas faire. */
const worklets = new WeakMap()
function loadWorklet(ctx) {
  if (!worklets.has(ctx))
    worklets.set(
      ctx,
      ctx.audioWorklet
        ? ctx.audioWorklet.addModule(workletUrl).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
    )
  return worklets.get(ctx)
}

const tubeNode = (ctx, name) => new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' })

/** Saturation douce et légèrement asymétrique (harmoniques paires, comme une lampe). */
function tubeCurve(samples = 4096) {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const u = ((i / (samples - 1)) * 2 - 1) * DRIVE_HEADROOM
    curve[i] = u >= 0 ? Math.tanh(u) : Math.tanh(1.25 * u) / 1.15
  }
  return curve
}

/** Sécurité de sortie : transparent sous 0,7, arrondi au-dessus, jamais au-delà de ±1. */
function safetyCurve(samples = 2048) {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    const a = Math.abs(x)
    curve[i] = a < 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3))
  }
  return curve
}

/** Réponse impulsionnelle de reverb : bruit stéréo qui décroît et s'assombrit. */
function reverbImpulse(ctx, seconds = 2.2) {
  const length = Math.floor(ctx.sampleRate * seconds)
  const ir = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c)
    let lp = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.45 * t) // de plus en plus sourd
      data[i] = lp * (1 - t) ** 3
    }
  }
  return ir
}

function biquad(ctx, type, frequency, { Q = 0.707, gain = 0 } = {}) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = Q
  f.gain.value = gain
  return f
}

/** Branche les nœuds les uns à la suite des autres ; renvoie le dernier. */
function chain(...nodes) {
  nodes.reduce((a, b) => (a.connect(b), b))
  return nodes.at(-1)
}

/**
 * Construit l'ampli à partir d'un nœud d'entrée (mono, guitare).
 * Renvoie (promesse) { set(params), setCabinet(buffer), inputLevel(), outputLevel(), gateOpen(), destroy() }.
 */
export async function createAmp(ctx, input) {
  const tubes = await loadWorklet(ctx)

  // --- Noise gate (gain piloté par le niveau d'entrée)
  const gate = ctx.createGain()
  const inputMeter = ctx.createAnalyser()
  inputMeter.fftSize = 512

  // --- Préampli
  const tight = biquad(ctx, 'highpass', 85) // graves resserrés avant la saturation
  const push = biquad(ctx, 'peaking', 750, { Q: 0.8, gain: 5 }) // bosse dans les médiums, façon crunch
  const preLow = biquad(ctx, 'lowpass', 7500)
  // Deux triodes (worklet) ou, à défaut, gain + courbe de saturation
  const preamp = tubes ? [tubeNode(ctx, 'tube-preamp')] : [ctx.createGain(), ctx.createWaveShaper()]
  if (!tubes) {
    preamp[1].curve = tubeCurve()
    preamp[1].oversample = '4x'
  }
  const dcBlock = biquad(ctx, 'highpass', 25) // l'asymétrie crée une composante continue
  const makeup = ctx.createGain()

  // --- Égaliseur
  const bass = biquad(ctx, 'lowshelf', 110)
  const mid = biquad(ctx, 'peaking', 700, { Q: 0.7 })
  const treble = biquad(ctx, 'highshelf', 2800)
  const presence = biquad(ctx, 'peaking', 4200, { Q: 1 })
  // Résonance de l'étage de puissance (« depth ») : du punch dans le grave, comme un vrai ampli à lampes
  const depth = biquad(ctx, 'peaking', 110, { Q: 0.9, gain: 3 })
  const power = tubes ? tubeNode(ctx, 'tube-power') : ctx.createGain()

  // --- Baffle : deux convolueurs en fondu enchaîné, pour changer de baffle / de micro sans clic
  const cabIn = ctx.createGain()
  const cabOut = ctx.createGain()
  const cabs = [0, 1].map(() => {
    const conv = ctx.createConvolver()
    conv.normalize = false // les réponses impulsionnelles sont déjà mises à niveau
    const gain = ctx.createGain()
    cabIn.connect(conv).connect(gain).connect(cabOut)
    return { conv, gain }
  })
  let activeCab = 0
  cabs[0].conv.buffer = cabinetImpulse(ctx, DEFAULT_CABINET)
  cabs[1].gain.gain.value = 0

  const master = ctx.createGain()

  // --- Effets en parallèle
  const delay = ctx.createDelay(1.5)
  delay.delayTime.value = DELAY_TIME
  const feedback = ctx.createGain()
  feedback.gain.value = DELAY_FEEDBACK
  const delayTone = biquad(ctx, 'lowpass', 3000)
  const delayWet = ctx.createGain()
  const reverb = ctx.createConvolver()
  reverb.buffer = reverbImpulse(ctx)
  const reverbWet = ctx.createGain()

  // --- Sortie : limiteur de sécurité pour les oreilles
  const bus = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.1
  const safety = ctx.createWaveShaper()
  safety.curve = safetyCurve()
  const outputMeter = ctx.createAnalyser()
  outputMeter.fftSize = 512

  input.connect(inputMeter)
  chain(input, gate, tight, push, preLow, ...preamp, dcBlock, makeup, bass, mid, treble, presence, depth, power, cabIn)
  const amp = chain(cabOut, master)
  amp.connect(bus)
  chain(amp, delay, delayTone, feedback, delay)
  chain(delayTone, delayWet, bus)
  chain(amp, reverb, reverbWet, bus)
  chain(bus, limiter, safety, ctx.destination)
  safety.connect(outputMeter)

  const nodes = [gate, tight, push, preLow, ...preamp, dcBlock, makeup, bass, mid, treble, presence, depth, power, cabIn, cabOut, ...cabs.flatMap((c) => [c.conv, c.gain]), master, delay, feedback, delayTone, delayWet, reverb, reverbWet, bus, limiter, safety, inputMeter, outputMeter]

  let params = { ...PRESETS[DEFAULT_PRESET] }
  const smooth = (param, value) => param.setTargetAtTime(value, ctx.currentTime, 0.02)

  function set(next) {
    params = { ...params, ...next }
    const p = params
    const preDb = 6 + p.gain * 3.6 // 6 dB (clean) → 42 dB (lead)
    if (tubes) {
      // Le gain se répartit entre les deux triodes : en clean, seule la 1re travaille un peu
      const v1Db = 8 + p.gain * 1.6
      const t = (n) => preamp[0].parameters.get(n)
      smooth(t('gain1'), dbToGain(v1Db))
      smooth(t('gain2'), dbToGain(preDb - v1Db))
      smooth(t('tight'), 30 + p.gain * 10) // plus de gain, grave plus serré entre les triodes (sinon ça bave)
    } else smooth(preamp[0].gain, dbToGain(preDb) / DRIVE_HEADROOM)
    smooth(makeup.gain, dbToGain(-p.gain * 0.6 + (tubes ? TUBES_MAKEUP_DB : 0))) // garde un volume à peu près constant quand on monte le gain
    smooth(bass.gain, eqDb(p.bass))
    smooth(mid.gain, eqDb(p.mid))
    smooth(treble.gain, eqDb(p.treble))
    smooth(presence.gain, eqDb(p.presence, 8))
    smooth(master.gain, p.master <= 0 ? 0 : dbToGain((p.master - 7) * 4 - 8)) // master à 7 ≈ -8 dB : marge pour le casque
    smooth(reverbWet.gain, (p.reverb / 10) ** 1.5 * 0.9)
    smooth(delayWet.gain, (p.delay / 10) ** 1.5 * 0.8)
  }
  set(params)
  if (tubes) {
    power.parameters.get('drive').value = POWER_DRIVE
    power.parameters.get('sag').value = SAG
  }

  // --- Noise gate : ouverture rapide, fermeture douce, avec hystérésis et maintien
  const buf = new Float32Array(inputMeter.fftSize)
  let inputDb = -100
  let open = false
  let lastLoud = 0
  const rmsDb = (analyser) => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return 20 * Math.log10(Math.max(Math.sqrt(sum / buf.length), 1e-8))
  }
  const timer = setInterval(() => {
    inputDb = rmsDb(inputMeter)
    const threshold = -84 + params.gate * 5 // 0 = gate coupé
    const now = performance.now()
    if (params.gate <= 0 || inputDb > threshold) lastLoud = now
    const shouldOpen = params.gate <= 0 || inputDb > threshold || (open && (inputDb > threshold - 6 || now - lastLoud < 80))
    if (shouldOpen !== open) {
      open = shouldOpen
      gate.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? 0.002 : 0.04)
    }
  }, 8)

  /** Nouveau baffle (AudioBuffer de réponse impulsionnelle) : fondu enchaîné de 50 ms. */
  function setCabinet(buffer) {
    const next = 1 - activeCab
    cabs[next].conv.buffer = buffer
    const t = ctx.currentTime
    cabs[next].gain.gain.setTargetAtTime(1, t, 0.015)
    cabs[activeCab].gain.gain.setTargetAtTime(0, t, 0.015)
    activeCab = next
  }

  return {
    set,
    setCabinet,
    inputLevel: () => inputDb,
    outputLevel: () => rmsDb(outputMeter),
    gateOpen: () => open,
    destroy() {
      clearInterval(timer)
      nodes.forEach((n) => n.disconnect())
    },
  }
}
