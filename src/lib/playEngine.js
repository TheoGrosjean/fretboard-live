/**
 * Moteur audio du mode Jouer : prépare l'accompagnement (rendu dans un worker + batterie synthétisée mixée)
 * et le lit avec une horloge précise (celle du contexte audio, corrigée de la latence de sortie).
 */
import soundFontUrl from '@coderline/alphatab/soundfont/sonivox.sf3?url'
import { createDrumKit } from './drumSynth'

const CMD = 'fretboard.render' // voir lib/renderWorker.js
// Fréquence du rendu, indépendante de la carte son (qui peut tourner à 96 ou 192 kHz) : un morceau de 5 min
// tient en ~100 Mo, et Web Audio rééchantillonne à la lecture. Pas moins de 44,1 kHz : en dessous, certains
// filtres de la banque de sons deviennent instables et le synthé produit des NaN (plus aucun son).
const RENDER_RATE = 44100

let worker = null
let soundFontSent = false
let requestId = 0
const pending = new Map()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./renderWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id)
    if (!p) return
    if (data.progress !== undefined && !data.done) return p.onProgress?.(data.progress)
    pending.delete(data.id)
    data.error ? p.reject(new Error(data.error)) : p.resolve(data)
  }
  // Plantage du worker (mémoire…) : on prévient au lieu de rester bloqué
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'le rendu audio a échoué'))
    pending.clear()
    worker.terminate()
    worker = null
    soundFontSent = false
  }
  return worker
}

/**
 * Sons de batterie pré-calculés : chaque son General MIDI utilisé est rendu une seule fois (pleine vélocité),
 * puis recopié dans la piste à chaque coup. Bien plus rapide que de synthétiser des milliers de coups.
 */
async function drumSamples(sampleRate, keys) {
  const LEN = 2.5 // s : assez pour la queue d'une cymbale
  const offline = new OfflineAudioContext(2, Math.ceil(sampleRate * LEN * keys.length), sampleRate)
  const kit = createDrumKit(offline)
  keys.forEach((key, i) => kit.hit(key, i * LEN, 127))
  const all = await offline.startRendering()
  const samples = new Map()
  keys.forEach((key, i) => {
    const from = Math.round(i * LEN * sampleRate)
    const chans = [0, 1].map((c) => all.getChannelData(c).subarray(from, from + Math.round(LEN * sampleRate)))
    // On coupe le silence de fin : moins de calcul au mixage
    let end = chans[0].length
    while (end > 0 && Math.abs(chans[0][end - 1]) < 1e-4 && Math.abs(chans[1][end - 1]) < 1e-4) end--
    samples.set(key, chans.map((d) => d.subarray(0, end)))
  })
  return samples
}

/**
 * Accompagnement prêt à jouer : AudioBuffer stéréo de tout le morceau (ou de range = { startTick, endTick }),
 * sans la piste `trackIndex`, à la vitesse `speed`.
 */
export async function renderBacking(ctx, { data, trackIndex, speed = 1, synthDrums = true, range = null, onProgress }) {
  const w = getWorker()
  const msg = { cmd: CMD, id: ++requestId, data: data.slice(0), trackIndex, speed, synthDrums, range, sampleRate: RENDER_RATE }
  const transfer = [msg.data]
  if (!soundFontSent) {
    msg.soundFont = await (await fetch(soundFontUrl)).arrayBuffer()
    transfer.push(msg.soundFont)
    soundFontSent = true
  }
  const result = await new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject, onProgress: (p) => onProgress?.(p * 0.85) })
    w.postMessage(msg, transfer)
  })

  // Sortie d'alphaTab, puis la batterie synthétisée mixée par-dessus
  const frames = Math.max(1, result.frames)
  // Laisse résonner la dernière cymbale ; pas en boucle (Riff Repeater), où la fin doit retomber pile sur le début
  const drumTail = result.drums.length && !range ? RENDER_RATE * 2 : 0
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: frames + drumTail, sampleRate: RENDER_RATE })
  buffer.copyToChannel(result.left.subarray(0, frames), 0)
  buffer.copyToChannel(result.right.subarray(0, frames), 1)
  result.left = result.right = null // libère la copie reçue du worker
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  if (result.drums.length) {
    const samples = await drumSamples(RENDER_RATE, [...new Set(result.drums.map((d) => d.key))])
    const outs = [left, right]
    result.drums.forEach((d, n) => {
      const sample = samples.get(d.key)
      const start = Math.round(d.time * RENDER_RATE)
      const gain = (d.velocity / 127) ** 1.4
      for (let c = 0; c < 2; c++) {
        const out = outs[c]
        const src = sample[c]
        const len = Math.min(src.length, out.length - start)
        for (let i = 0; i < len; i++) out[start + i] += src[i] * gain
      }
      if (n % 500 === 0) onProgress?.(0.85 + (0.13 * n) / result.drums.length)
    })
  }
  // Mise au niveau : le pic du morceau à −0,5 dB, quel que soit le volume d'origine du fichier.
  // Au passage, une valeur invalide (NaN) devient du silence au lieu de couper tout le son.
  let peak = 0
  for (let c = 0; c < 2; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i])
      if (a > peak) peak = a
      else if (a !== a) d[i] = 0
    }
  }
  if (peak > 0) {
    const gain = 0.94 / peak
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c)
      for (let i = 0; i < d.length; i++) d[i] *= gain
    }
  }
  onProgress?.(1)
  return buffer
}

/**
 * Lecteur : start(buffer, { offset, loop }), stop(), time() = position entendue dans le buffer (s),
 * loops() = nombre de tours de boucle effectués.
 */
export function createTransport(ctx) {
  // Volume (jusqu'à +12 dB) → compresseur qui densifie le son → limiteur : fort, sans saturer
  const out = ctx.createGain()
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = -16
  glue.knee.value = 8
  glue.ratio.value = 4
  glue.attack.value = 0.004
  glue.release.value = 0.18
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.08
  out.connect(glue).connect(limiter).connect(ctx.destination)
  let source = null
  let startedAt = 0
  let offset = 0
  let length = 0
  let looping = false

  const latency = () => (ctx.baseLatency || 0) + (ctx.outputLatency || 0)
  const elapsed = () => ctx.currentTime - startedAt - latency()

  return {
    out,
    start(buffer, { offset: from = 0, loop = false, loopEnd = 0, delay = 0 } = {}) {
      this.stop()
      source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = loop
      if (loop && loopEnd) source.loopEnd = loopEnd
      source.connect(out)
      startedAt = ctx.currentTime + delay
      source.start(startedAt, from)
      offset = from
      length = loop && loopEnd ? loopEnd : buffer.duration
      looping = loop
    },
    stop() {
      try {
        source?.stop()
      } catch {
        // déjà arrêté
      }
      source?.disconnect()
      source = null
    },
    /** Position entendue (s) dans le buffer ; négative pendant le décompte. */
    time() {
      const t = offset + elapsed()
      return looping && t >= 0 ? t % length : t
    },
    loops: () => (looping ? Math.floor((offset + elapsed()) / length) : 0),
    setVolume: (v) => out.gain.setTargetAtTime(v, ctx.currentTime, 0.03),
  }
}
