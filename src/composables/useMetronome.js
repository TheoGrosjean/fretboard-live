import { computed, ref, watch } from 'vue'

/**
 * Moteur du métronome : tempo, mesure, accent, subdivision, et l'horloge audio qui programme les clics.
 * Les clics sont programmés sur l'horloge audio avec un peu d'avance : le tempo ne dérive jamais.
 *
 * Il sait aussi dire « où on en est » : beatAt(performance.now()) donne la position en temps
 * depuis le premier clic, telle que l'oreille l'entend (latence de sortie comprise). La page Phrasés
 * s'en sert pour placer les notes jouées sur la grille.
 *
 * Deux accroches pour la page Phrasés :
 * - setMute(fn) : fn(mesure) -> true coupe le clic de cette mesure (travail du tempo intérieur) ;
 * - setScheduler(fn) : appelée à chaque programmation avec la tranche de temps à venir, pour jouer d'autres
 *   sons (la démo du phrasé) sur la même horloge que le clic, donc parfaitement en place.
 *
 * storageKey : préfixe des réglages mémorisés (fb.<storageKey>.bpm…), pour que chaque page garde les siens.
 */
export const MIN_BPM = 40
export const MAX_BPM = 240
export const SIGNATURES = [2, 3, 4, 6]
export const SUBDIVISIONS = [
  { n: 1, label: '♩', name: 'Noires' },
  { n: 2, label: '♫', name: 'Croches' },
  { n: 3, label: '♫', tuplet: 3, name: 'Triolets' },
  { n: 4, label: '♬', name: 'Doubles croches' },
]
const LOOKAHEAD = 0.12 // s programmées à l'avance
// Volume : le curseur 0–1 suit une échelle en décibels (l'oreille est logarithmique), jusqu'à +12 dB ;
// un limiteur en sortie évite la saturation quand on pousse à fond
const VOLUME_MIN_DB = -36
const VOLUME_MAX_DB = 12
export const volumeGain = (v) => (v <= 0 ? 0 : 10 ** ((VOLUME_MIN_DB + (VOLUME_MAX_DB - VOLUME_MIN_DB) * v) / 20))
export const volumeDb = (v) => (v <= 0 ? -Infinity : Math.round(VOLUME_MIN_DB + (VOLUME_MAX_DB - VOLUME_MIN_DB) * v))

// ---------- Sons du clic (au choix dans les réglages, communs à tous les métronomes) ----------
export const CLICK_SOUNDS = [
  { id: 'wood', label: 'Bois' },
  { id: 'bip', label: 'Bip' },
  { id: 'drums', label: 'Batterie' },
  { id: 'stick', label: 'Baguette' },
  { id: 'hat', label: 'Charleston' },
  { id: 'cowbell', label: 'Cloche' },
]
const SOUND_KEY = 'fb.metronome.sound'
export const clickSound = ref(
  (() => {
    try {
      const v = JSON.parse(localStorage.getItem(SOUND_KEY)) ?? 'wood'
      return v === 'clave' ? 'drums' : v // les claves ont laissé la place à la batterie
    } catch {
      return 'wood'
    }
  })(),
)
watch(clickSound, (v) => localStorage.setItem(SOUND_KEY, JSON.stringify(v)))

const noiseBuffers = new WeakMap() // un bruit blanc court par contexte audio
function noiseOf(ctx) {
  if (!noiseBuffers.has(ctx)) {
    const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.15), ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, b)
  }
  return noiseBuffers.get(ctx)
}
/** Enveloppe percussive : montée de 1 ms, puis extinction exponentielle en `decay` s. */
function env(ctx, time, peak, decay) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, time)
  g.gain.linearRampToValueAtTime(peak, time + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0008, time + decay)
  return g
}
function tone(ctx, dest, time, { freq, type = 'sine', peak, decay, drop = 0 }) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, time)
  if (drop) osc.frequency.exponentialRampToValueAtTime(freq * (1 - drop), time + decay)
  osc.connect(env(ctx, time, peak, decay)).connect(dest)
  osc.start(time)
  osc.stop(time + decay + 0.02)
  return osc
}
function noise(ctx, dest, time, { filter, freq, q = 1, peak, decay }) {
  const src = ctx.createBufferSource()
  src.buffer = noiseOf(ctx)
  const f = ctx.createBiquadFilter()
  f.type = filter
  f.frequency.value = freq
  f.Q.value = q
  src.connect(f).connect(env(ctx, time, peak, decay)).connect(dest)
  src.start(time)
  src.stop(time + decay + 0.02)
}

/** Batterie : grosse caisse, caisse claire, charleston. */
function kick(ctx, dest, time, peak) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(150, time)
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12)
  osc.connect(env(ctx, time, peak * 0.75, 0.28)).connect(dest)
  osc.start(time)
  osc.stop(time + 0.3)
}
function snare(ctx, dest, time, peak) {
  noise(ctx, dest, time, { filter: 'bandpass', freq: 1900, q: 0.7, peak: peak * 1.1, decay: 0.14 })
  tone(ctx, dest, time, { freq: 190, peak: peak * 0.6, decay: 0.08, drop: 0.2 })
}
const hat = (ctx, dest, time, peak) => noise(ctx, dest, time, { filter: 'highpass', freq: 7500, peak: peak * 0.5, decay: 0.035 })

/**
 * Joue un clic. level : 2 premier temps accentué, 1 temps, 0 subdivision (plus discrète).
 * Chaque son garde la même logique : l'accent est plus aigu, la subdivision plus douce.
 * beat : rang du temps dans la mesure (la batterie joue un rythme : grosse caisse, caisse claire).
 */
export function playClick(ctx, dest, time, level, sound = clickSound.value, beat = level === 2 ? 0 : 1) {
  const peak = [0.3, 0.6, 1][level]
  const pitch = [0.8, 1, 1.32][level]
  switch (sound) {
    case 'wood': // bloc de bois : deux résonances très brèves et un souffle d'attaque
      tone(ctx, dest, time, { freq: 880 * pitch, peak: peak * 0.75, decay: 0.035 })
      tone(ctx, dest, time, { freq: 1980 * pitch, peak: peak * 0.35, decay: 0.02 })
      noise(ctx, dest, time, { filter: 'bandpass', freq: 1600 * pitch, q: 3, peak: peak * 0.5, decay: 0.012 })
      break
    case 'drums': // batterie : grosse caisse sur le 1 (et le 3), caisse claire sur les autres temps, charleston partout
      if (level === 0) hat(ctx, dest, time, 0.6)
      else {
        hat(ctx, dest, time, 1)
        if (beat === 0 || beat % 2 === 0) kick(ctx, dest, time, level === 2 ? 1 : 0.8)
        else snare(ctx, dest, time, 0.8)
      }
      break
    case 'stick': // baguette sur un cercle de caisse : clac bref, très présent
      noise(ctx, dest, time, { filter: 'bandpass', freq: 2600 * pitch, q: 1.4, peak: peak * 1.8, decay: 0.022 })
      tone(ctx, dest, time, { freq: 1700 * pitch, peak: peak * 0.4, decay: 0.015 })
      break
    case 'hat': // charleston fermée : souffle aigu, l'accent un peu plus ouvert
      noise(ctx, dest, time, { filter: 'highpass', freq: 7000, peak: peak * 0.75, decay: level === 2 ? 0.09 : 0.035 })
      break
    case 'cowbell': // cloche : deux carrés dissonants filtrés, une queue plus longue
      {
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 820 * pitch
        bp.Q.value = 2.5
        const decay = level === 0 ? 0.08 : 0.16
        bp.connect(env(ctx, time, peak * 0.65, decay)).connect(dest)
        for (const f of [545, 815]) {
          const osc = ctx.createOscillator()
          osc.type = 'square'
          osc.frequency.value = f * pitch
          osc.connect(bp)
          osc.start(time)
          osc.stop(time + decay + 0.02)
        }
      }
      break
    default: // bip : une sinusoïde aiguë qui s'éteint en 40 ms
      tone(ctx, dest, time, { freq: [880, 1175, 1760][level], peak, decay: 0.045 })
  }
}

let previewCtx = null
/** Fait entendre un son de clic (accent puis deux temps), depuis les réglages. */
export function previewClick(sound) {
  previewCtx ??= new AudioContext()
  previewCtx.resume()
  const out = previewCtx.createGain()
  out.gain.value = 0.7
  out.connect(previewCtx.destination)
  const t = previewCtx.currentTime + 0.03
  ;[2, 1, 1, 1].forEach((level, i) => playClick(previewCtx, out, t + i * 0.28, level, sound, i))
}

export function useMetronome({ storageKey = 'metronome' } = {}) {
  function stored(key, initial) {
    try {
      const v = localStorage.getItem(`fb.${storageKey}.${key}`)
      return v !== null ? JSON.parse(v) : initial
    } catch {
      return initial
    }
  }
  const bpm = ref(stored('bpm', 90))
  const beats = ref(stored('beats', 4)) // temps par mesure
  const accent = ref(stored('accent', true))
  const volume = ref(stored('volume', 0.7))
  const subdiv = ref(stored('subdiv', 1)) // clics par temps : 1 noire, 2 croches, 3 triolet, 4 doubles croches
  watch([bpm, beats, accent, volume, subdiv], () => {
    for (const [key, r] of Object.entries({ bpm, beats, accent, volume, subdiv })) localStorage.setItem(`fb.${storageKey}.${key}`, JSON.stringify(r.value))
  })

  const clamp = (v) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)))
  const setBpm = (v) => (bpm.value = clamp(v))

  // Nom du tempo, à l'italienne (repère musical)
  const tempoName = computed(() => {
    const v = bpm.value
    return v < 60 ? 'Largo' : v < 76 ? 'Adagio' : v < 108 ? 'Andante' : v < 120 ? 'Moderato' : v < 168 ? 'Allegro' : 'Presto'
  })

  // ---------- Son et horloge ----------
  let ctx = null
  let out = null
  let timer = 0
  let nextTime = 0
  let beatIndex = 0
  let subIndex = 0 // subdivision dans le temps
  let tick = 0 // temps (fractionnaires) programmés depuis le départ
  let anchors = [] // { time, beat, bpm } : repères de l'horloge, un nouveau à chaque changement de tempo
  let guide = null // sortie des sons programmés par setScheduler (démo du phrasé)
  let mute = null // (mesure) -> true : clic coupé
  let scheduler = null // ({ from, to, timeAt, ctx, dest }) : sons à programmer entre les temps from et to
  let scheduledTo = 0 // temps jusqu'auquel le scheduler a déjà programmé
  const playing = ref(false)
  const current = ref(-1) // temps qui vient de sonner (pour les pastilles)
  const pending = [] // { time, beat } : temps programmés, affichés quand ils sonnent

  // level : 2 premier temps accentué, 1 temps, 0 subdivision (plus discrète) ; le son choisi dans les réglages
  const click = (time, level) => playClick(ctx, out, time, level, clickSound.value, beatIndex)

  /** Instant de l'horloge audio d'un temps (programmé, avant la latence de sortie). */
  function timeAtBeat(beat) {
    const a = anchors.findLast((x) => x.beat <= beat + 1e-9) ?? anchors[0]
    return a.time + ((beat - a.beat) * 60) / a.bpm
  }

  function schedule() {
    const horizon = ctx.currentTime + LOOKAHEAD
    while (nextTime < horizon) {
      if (anchors.at(-1).bpm !== bpm.value) anchors.push({ time: nextTime, beat: tick, bpm: bpm.value })
      const silent = mute?.(Math.floor(tick / beats.value + 1e-9))
      if (subIndex === 0) {
        if (!silent) click(nextTime, accent.value && beatIndex === 0 ? 2 : 1)
        pending.push({ time: nextTime, beat: beatIndex })
      } else if (!silent) click(nextTime, 0)
      nextTime += 60 / bpm.value / subdiv.value
      tick += 1 / subdiv.value
      if (++subIndex >= subdiv.value) {
        subIndex = 0
        tick = Math.round(tick) // pas d'erreur d'arrondi qui s'accumule (triolets)
        beatIndex = (beatIndex + 1) % beats.value
      }
    }
    if (scheduler) {
      const a = anchors.at(-1)
      const to = a.beat + ((horizon - a.time) * a.bpm) / 60
      if (to > scheduledTo) {
        scheduler({ from: scheduledTo, to, timeAt: timeAtBeat, ctx, dest: guide })
        scheduledTo = to
      }
    }
    if (anchors.length > 8) anchors = anchors.slice(-8)
    // Pastille du temps qui sonne maintenant (même horloge que beatAt : pastilles et curseurs restent ensemble)
    const heard = heardTime(performance.now())
    while (pending.length && pending[0].time <= heard) current.value = pending.shift().beat
  }

  async function start() {
    ctx ??= new AudioContext({ latencyHint: 'interactive' })
    if (!out) {
      out = ctx.createGain()
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -1
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.001
      limiter.release.value = 0.05
      out.connect(limiter).connect(ctx.destination)
      guide = ctx.createGain()
      guide.gain.value = guideVolume
      guide.connect(limiter)
    }
    out.gain.value = volumeGain(volume.value)
    await ctx.resume()
    clearInterval(timer)
    beatIndex = 0
    subIndex = 0
    tick = 0
    pending.length = 0
    nextTime = ctx.currentTime + 0.05
    anchors = [{ time: nextTime, beat: 0, bpm: bpm.value }]
    scheduledTo = 0
    timer = setInterval(schedule, 20)
    playing.value = true
  }
  function stop() {
    clearInterval(timer)
    timer = 0
    playing.value = false
    current.value = -1
    pending.length = 0
  }
  const toggle = () => (playing.value ? stop() : start())
  watch(volume, (v) => out?.gain.setTargetAtTime(volumeGain(v), ctx.currentTime, 0.02))
  watch(beats, () => (beatIndex %= beats.value))

  /**
   * Instant de l'horloge audio qu'on entend à l'instant performance.now() perfMs : ce qui sort des
   * haut-parleurs, latence de sortie comprise. Source unique pour les pastilles, la frise et les notes jouées.
   */
  function heardTime(perfMs) {
    const ts = ctx.getOutputTimestamp?.()
    // getOutputTimestamp : l'instant audio en train d'être entendu, daté sur l'horloge de performance.now()
    if (ts?.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - (performance.now() - perfMs) / 1000
  }

  /**
   * Position, en temps depuis le premier clic, d'un instant performance.now() (ms) : 0 = premier clic,
   * 1 = deuxième temps… Tient compte de la latence de sortie (on joue sur le clic qu'on entend).
   * null si le métronome est arrêté.
   */
  function beatAt(perfMs) {
    if (!playing.value || !ctx) return null
    const time = heardTime(perfMs)
    const a = anchors.findLast((x) => x.time <= time) ?? anchors[0]
    return a.beat + ((time - a.time) * a.bpm) / 60
  }

  // ---------- Tap tempo : moyenne des derniers intervalles ----------
  let taps = []
  function tap() {
    const now = performance.now()
    if (taps.length && now - taps.at(-1) > 2000) taps = [] // pause trop longue : on recommence
    taps.push(now)
    taps = taps.slice(-6)
    if (taps.length < 2) return
    const gaps = taps.slice(1).map((t, i) => t - taps[i])
    setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length))
  }

  /** Rythme précédent / suivant (flèches ← →) */
  function stepSubdiv(dir) {
    const i = SUBDIVISIONS.findIndex((d) => d.n === subdiv.value) + dir
    subdiv.value = SUBDIVISIONS[(i + SUBDIVISIONS.length) % SUBDIVISIONS.length].n
  }

  /** Coupe le clic des mesures pour lesquelles fn(mesure) est vrai (null : clic partout). */
  const setMute = (fn) => (mute = fn)
  /** Programme d'autres sons sur l'horloge du clic (voir l'en-tête) ; null pour arrêter. */
  const setScheduler = (fn) => (scheduler = fn)
  let guideVolume = 0.8
  function setGuideVolume(v) {
    guideVolume = v
    guide?.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
  }

  function dispose() {
    stop()
    ctx?.close()
    ctx = null
    out = null
    guide = null
  }

  return { bpm, beats, accent, volume, subdiv, playing, current, tempoName, setBpm, start, stop, toggle, tap, stepSubdiv, beatAt, setMute, setScheduler, setGuideVolume, dispose }
}
