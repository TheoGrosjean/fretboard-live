import { computed, ref, shallowRef, onBeforeUnmount } from 'vue'
import { createYinDetector } from '../lib/pitch'
import { freqToMidi, midiToFreq } from '../lib/music'
import { isSlide } from '../lib/combo'

const STABLE_FRAMES = 3 // nombre de trames identiques avant de valider une note
const RELEASE_MS = 120 // silence nécessaire avant de considérer la note terminée
// Changement de note sans nouvelle attaque (slide, bend, legato) : la note doit tenir plus longtemps,
// pour ignorer les notes traversées pendant un slide
const LEGATO_STABLE_MS = 110
// Bend : la hauteur monte en continu (hauteurs entre deux demi-tons), sans nouvelle attaque,
// de ½ ton à 1 ton ½. Un slide avance par paliers (cases), un hammer-on saute d'un coup.
const BEND_MAX_SEMITONES = 3
const BEND_MIN_GLIDE_FRAMES = 3 // trames en mouvement depuis la note de départ
const BEND_BETWEEN_RATIO = 0.35 // part de ces trames entre deux demi-tons
const BEND_BETWEEN_CENTS = 20 // écart au demi-tonne le plus proche pour être « entre deux »
const BEND_CONTINUE_MS = 600 // un bend lent peut valider le demi-ton intermédiaire : on le prolonge
// Attaques : le volume est suivi tous les 4 ms (la fenêtre de hauteur, ~85 ms, noie les attaques rapprochées,
// comme des palm mutes en doubles croches), sur une fenêtre d'au moins une période de la note la plus grave
// (sinon le volume d'une tranche varie avec la forme de l'onde). Une attaque = un volume au moins 1,8 fois
// plus fort que le plus faible des 40 ms qui précèdent.
const ONSET_BLOCK_MS = 4
const ONSET_LOOKBACK_MS = 40
const ONSET_RATIO = 1.8
// Le « clic » du médiator : sur le signal dérivé (les aigus), une note rejouée pendant qu'elle sonne encore
// se voit nettement, même quand le volume global monte peu
const PICK_RATIO = 2.5
const ONSET_REFRACTORY_MS = 45 // deux attaques ne sont pas plus proches
// Palm mute : la note étouffée s'éteint vite ; 90 ms après l'attaque, elle a perdu plus de 10 dB
const MUTE_PROBE_MS = 90
const MUTE_DROP = 0.3

// Échelles en décibels : l'oreille (et le signal d'une guitare) suit une loi logarithmique
const METER_MIN_DB = -80 // bas du vu-mètre
const THRESHOLD_MAX_DB = -20 // seuil à 0 % de sensibilité
const THRESHOLD_MIN_DB = -70 // seuil à 100 % de sensibilité

const toDb = (rms) => 20 * Math.log10(Math.max(rms, 1e-8))
const fromDb = (db) => 10 ** (db / 20)
/** Position 0–1 d'un niveau en dB sur le vu-mètre */
const meterPosition = (db) => Math.min(1, Math.max(0, (db - METER_MIN_DB) / -METER_MIN_DB))
/** Sensibilité 0–100 -> seuil RMS */
const thresholdDb = (sensitivity) => THRESHOLD_MAX_DB + ((THRESHOLD_MIN_DB - THRESHOLD_MAX_DB) * sensitivity) / 100

/**
 * Suivi d'une voix (une guitare) : détection de hauteur trame par trame, validation des notes,
 * attaques, legato et slides. `onNote` est appelé à chaque nouvelle note.
 */
export function createVoiceTracker({ sampleRate, bufferSize, minFreq, threshold, onNote }) {
  const detect = createYinDetector(sampleRate, bufferSize, { minFreq })
  // Juste après une attaque, la longue fenêtre contient encore la note précédente : la hauteur est cherchée
  // sur une fenêtre courte (un peu plus de deux périodes de la note la plus grave), prise sur les échantillons
  // les plus récents — une note étouffée (palm mute) s'éteint avant que la longue fenêtre soit propre
  const shortSize = 2 ** Math.ceil(Math.log2(Math.ceil((2.2 * sampleRate) / minFreq)))
  const detectShort = shortSize < bufferSize ? createYinDetector(sampleRate, shortSize, { minFreq }) : null
  const shortMs = (shortSize / sampleRate) * 1000
  const block = Math.max(64, Math.round((sampleRate * ONSET_BLOCK_MS) / 1000)) // pas du suivi
  const span = Math.max(block, Math.round((sampleRate * 1.1) / minFreq)) // fenêtre du volume : une période et un peu plus
  const lookback = Math.round((sampleRate * ONSET_LOOKBACK_MS) / 1000)
  const windowMs = (bufferSize / sampleRate) * 1000
  let lastFrameAt = 0
  let lastOnsetAt = -Infinity
  let pendingOnsetAt = null // instant de la dernière attaque pas encore attribuée à une note
  let pendingPeak = 0 // volume au sommet de cette attaque
  let probe = null // { note, at, peak } : mesure de l'extinction de la dernière note (palm mute)
  let candidate = null
  let candidateCount = 0
  let candidateSince = 0
  let attackPending = false // une attaque a eu lieu depuis la dernière note émise
  let swept = new Set() // demi-tons entendus depuis la dernière note émise (pour reconnaître un slide)
  let lastSoundAt = 0
  let current = null // note stabilisée en cours : { midi, freq, cents }
  // Suivi du glissé continu depuis la dernière note émise (pour reconnaître un bend)
  let glideFrames = 0
  let betweenFrames = 0
  let bendFrom = null // note de départ du bend en cours
  let lastBendAt = 0

  /** Volume (RMS) de la fenêtre qui se termine à l'échantillon `end`. */
  function rmsBefore(buffer, end) {
    let sum = 0
    for (let i = end - span; i < end; i++) sum += buffer[i] * buffer[i]
    return Math.sqrt(sum / span)
  }
  /** Même chose sur le signal dérivé (les aigus : le clic du médiator). */
  function pickBefore(buffer, end) {
    let sum = 0
    for (let i = end - span; i < end; i++) sum += (buffer[i] - buffer[i - 1]) ** 2
    return Math.sqrt(sum / span)
  }
  /** Attaque dans les échantillons arrivés depuis la trame précédente : { at (ms), peak }, ou null. */
  function findOnset(buffer, now) {
    const fresh = Math.round(((now - lastFrameAt) / 1000) * sampleRate) + block
    lastFrameAt = now
    const start = Math.max(span + lookback + 1, buffer.length - Math.min(fresh, buffer.length / 2))
    // Référence : seulement des fenêtres entièrement après la dernière attaque (sinon le silence d'avant
    // une note la ferait repérer une seconde fois)
    const endTime = (e) => now - ((buffer.length - e) / sampleRate) * 1000
    const afterLast = (e) => endTime(e) - (span / sampleRate) * 1000 >= lastOnsetAt
    let floor = Infinity
    let pickFloor = Infinity
    for (let e = start - lookback; e < start; e += block) {
      if (!afterLast(e)) continue
      floor = Math.min(floor, rmsBefore(buffer, e))
      pickFloor = Math.min(pickFloor, pickBefore(buffer, e))
    }
    for (let e = start; e <= buffer.length; e += block) {
      const r = rmsBefore(buffer, e)
      const k = pickBefore(buffer, e)
      if (!afterLast(e)) continue
      if ((r > floor * ONSET_RATIO || k > pickFloor * PICK_RATIO) && r > threshold() * 1.3) {
        // L'attaque est entrée dans la fenêtre peu avant qu'elle franchisse le seuil
        const at = endTime(e - span * 0.35)
        if (at - lastOnsetAt < ONSET_REFRACTORY_MS) return null
        lastOnsetAt = at
        // Sommet de l'attaque : le volume le plus fort depuis
        let peak = r
        for (let c = e + block; c <= buffer.length; c += block) peak = Math.max(peak, rmsBefore(buffer, c))
        return { at, peak, index: Math.round(e - span * 0.35) }
      }
      floor = Math.min(floor, r)
      pickFloor = Math.min(pickFloor, k)
    }
    return null
  }
  /**
   * Palm mute : la note mesurée s'est-elle éteinte très vite ? Décidé une fois, MUTE_PROBE_MS après son attaque,
   * ou à l'attaque suivante si elle arrive avant (le volume est alors pris juste avant cette attaque).
   */
  function checkMute(buffer, now, nextOnset = null) {
    if (!probe) return
    if (!nextOnset && now - probe.at < MUTE_PROBE_MS) return
    const end = nextOnset ? Math.max(span + 1, nextOnset.index) : buffer.length
    const elapsed = (nextOnset ? nextOnset.at : now) - probe.at
    if (elapsed >= 40) probe.note.muted = rmsBefore(buffer, end) < probe.peak * MUTE_DROP
    probe = null
  }

  /** Traite une trame ; renvoie le niveau (0–1 sur le vu-mètre) et la hauteur brute, ou null. */
  function process(buffer, now) {
    let sum = 0
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
    const rms = Math.sqrt(sum / buffer.length)
    const level = meterPosition(toDb(rms))

    // Attaque : forte hausse du volume => nouvelle note même si identique (sur tranches courtes, ou à
    // défaut sur toute la fenêtre)
    const onset = findOnset(buffer, now)
    const attack = onset !== null
    if (attack) {
      pendingOnsetAt = onset.at
      pendingPeak = onset.peak
      // La fenêtre de hauteur contient encore la note précédente : la hauteur est revalidée sur les trames
      // suivantes (la note gardera l'instant de l'attaque)
      candidate = null
      candidateCount = 0
    }
    checkMute(buffer, now, onset)
    if (probe && now - probe.at < 30) probe.peak = Math.max(probe.peak, rmsBefore(buffer, buffer.length))
    if (attack) {
      attackPending = true
      swept = new Set()
    }

    // Note fraîchement attaquée : fenêtre courte (dès qu'elle ne contient plus que la nouvelle note)
    const fresh = detectShort && attackPending && pendingOnsetAt !== null && now - pendingOnsetAt < windowMs
    if (fresh && rms > threshold() && now - pendingOnsetAt < shortMs) {
      lastSoundAt = now
      return { level, freq: null, midiFloat: null } // encore trop tôt : on attend la fenêtre propre
    }
    const result = rms > threshold() ? (fresh ? detectShort(buffer.subarray(buffer.length - shortSize)) : detect(buffer)) : null
    if (!result) {
      if (now - lastSoundAt > RELEASE_MS) {
        current = null
        candidate = null
        candidateCount = 0
        swept = new Set()
      }
      return { level, freq: null, midiFloat: null }
    }

    lastSoundAt = now
    const m = freqToMidi(result.freq)
    const rounded = Math.round(m)
    swept.add(rounded)
    if (current && Math.abs(m - current.midi) > 0.3) {
      glideFrames++
      if (Math.abs(m - rounded) * 100 > BEND_BETWEEN_CENTS) betweenFrames++
    }

    if (rounded === candidate) candidateCount++
    else {
      candidate = rounded
      candidateCount = 1
      candidateSince = now
    }

    const previous = current
    // Note attaquée (ou première note après un silence) : validation rapide ; sinon on attend qu'elle tienne
    const legato = Boolean(previous) && !attackPending
    const stable = legato ? candidateCount >= STABLE_FRAMES && now - candidateSince >= LEGATO_STABLE_MS : candidateCount >= (fresh ? 2 : STABLE_FRAMES)
    if (stable) {
      const isNew = !previous || previous.midi !== rounded || attackPending
      current = { midi: rounded, freq: result.freq, cents: (m - rounded) * 100 }
      if (isNew) {
        // Grand glissé sans nouvelle attaque, en passant par les cases intermédiaires
        const slide = legato && isSlide(previous.midi, rounded, swept) ? { from: previous.midi, to: rounded } : null
        const bend = legato && !slide ? detectBend(previous.midi, rounded, now) : null
        // Instant de la note : son attaque si elle en a une, sinon (lié) le changement de hauteur
        const at = !legato && pendingOnsetAt !== null ? pendingOnsetAt : candidateSince - windowMs / 2
        const note = { ...current, legato, slide, bend, at, muted: false }
        pendingOnsetAt = null
        if (!legato && !bend) probe = { note, at, peak: Math.max(pendingPeak, rmsBefore(buffer, buffer.length)) }
        onNote(note)
        attackPending = false
        swept = new Set([rounded])
        glideFrames = 0
        betweenFrames = 0
      }
    }
    return { level, freq: result.freq, midiFloat: m }
  }

  /**
   * Bend arrivé sur `to` depuis `prev` : { from, to, steps, continued } ou null.
   * continued : prolongement d'un bend déjà annoncé (bend lent qui a validé le demi-ton intermédiaire).
   */
  function detectBend(prev, to, now) {
    const continuing = bendFrom !== null && now - lastBendAt < BEND_CONTINUE_MS
    const smooth = glideFrames >= BEND_MIN_GLIDE_FRAMES && betweenFrames / glideFrames >= BEND_BETWEEN_RATIO
    const from = continuing ? bendFrom : prev
    const steps = to - from
    if (!smooth || Math.abs(to - prev) > BEND_MAX_SEMITONES || steps === 0 || Math.abs(steps) > BEND_MAX_SEMITONES) {
      bendFrom = null
      return null
    }
    bendFrom = from
    lastBendAt = now
    return { from, to, steps, continued: continuing }
  }

  return { process, current: () => current }
}

/**
 * Capture l'entrée audio (ex. Focusrite Scarlett), détecte la hauteur en temps réel
 * et émet un événement à chaque nouvelle note jouée.
 * Mode duo : les deux entrées de l'interface sont suivies séparément (deux guitares) ;
 * chaque note porte alors `player` (0 = entrée 1, 1 = entrée 2).
 */
/**
 * lowestMidi : note de la corde la plus grave (fonction), pour régler la détection : une 7 cordes descend
 * jusqu'au Si grave (62 Hz), voire au La (55 Hz) en Drop A.
 */
export function useAudioInput({ onNote, lowestMidi = () => 40 } = {}) {
  const devices = ref([])
  const deviceId = ref(localStorage.getItem('fb.deviceId') || '')
  const channel = ref(localStorage.getItem('fb.channel') || 'mix') // 'mix' | '0' | '1'
  const duo = ref(false) // deux guitares : entrée 1 et entrée 2 suivies séparément
  const levels = ref([0, 0]) // niveaux par entrée, en mode duo
  const channelCount = ref(0) // canaux réellement fournis par l'interface
  const sensitivity = ref(Number(localStorage.getItem('fb.sensitivityPct') || 60)) // 0–100 %
  // Seuil RMS sous lequel le signal est ignoré, et sa position sur le vu-mètre
  const threshold = computed(() => fromDb(thresholdDb(sensitivity.value)))
  const thresholdLevel = computed(() => meterPosition(thresholdDb(sensitivity.value)))
  const running = ref(false)
  const error = ref('')
  const level = ref(0)
  const sampleRate = ref(0)

  // Données brutes de la trame courante (pour l'accordeur)
  const frequency = ref(null)
  const midiFloat = ref(null)
  // Note stabilisée en cours
  const current = shallowRef(null) // { midi, freq, cents }

  let ctx = null
  let stream = null
  let nodes = []
  let voices = [] // [{ analyser, buffer, tracker }]
  let raf = 0

  async function refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices()
    devices.value = all.filter((d) => d.kind === 'audioinput' && d.deviceId)
    const hasLabels = devices.value.some((d) => d.label)
    if (!hasLabels) return
    if (!deviceId.value ||!devices.value.some((d) => d.deviceId === deviceId.value)) {
      const focusrite = devices.value.find((d) => /focusrite|scarlett|clarett|vocaster/i.test(d.label))
      deviceId.value = (focusrite ?? devices.value[0])?.deviceId ?? ''
    }
  }

  async function start() {
    error.value = ''
    stop()
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId.value ? { exact: deviceId.value } : undefined,
          // Indispensable : ces traitements déforment le signal de la guitare
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
      })
      // Les noms des périphériques ne sont visibles qu'après autorisation
      // Au premier lancement, on bascule automatiquement sur la Focusrite si elle est détectée
      const previous = deviceId.value
      await refreshDevices()
      const actual = stream.getAudioTracks()[0]?.getSettings().deviceId
      if (!previous && deviceId.value && actual && deviceId.value !== actual) return start()
      if (actual) deviceId.value = actual

      ctx = new AudioContext({ latencyHint: 'interactive' })
      await ctx.resume()
      sampleRate.value = ctx.sampleRate

      const source = ctx.createMediaStreamSource(stream)
      channelCount.value = stream.getAudioTracks()[0]?.getSettings().channelCount ?? source.channelCount
      // Fenêtre d'analyse : au moins trois périodes de la note la plus grave (la détection a besoin de
      // comparer deux périodes entières), et jamais moins qu'avant (2048 échantillons)
      const lowFreq = midiToFreq(lowestMidi())
      const fftSize = 2 ** Math.ceil(Math.log2(Math.max(2048, (3 * ctx.sampleRate) / lowFreq)))
      const minFreq = Math.min(65, lowFreq * 0.85) // un peu de marge sous la corde à vide (accordage bas)
      nodes = [source]
      const addVoice = (player) => {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = fftSize
        nodes.push(analyser)
        const emit = player === null ? (n) => onNote?.(n) : (n) => onNote?.({ ...n, player })
        const tracker = createVoiceTracker({ sampleRate: ctx.sampleRate, bufferSize: fftSize, minFreq, threshold: () => threshold.value, onNote: emit })
        voices.push({ analyser, buffer: new Float32Array(fftSize), tracker })
        return analyser
      }

      if (duo.value) {
        // Deux guitares : une voix par entrée de l'interface
        const splitter = ctx.createChannelSplitter(2)
        source.connect(splitter)
        nodes.push(splitter)
        splitter.connect(addVoice(0), 0)
        splitter.connect(addVoice(1), 1)
        if (channelCount.value < 2) error.value = "L'interface n'envoie qu'un canal au navigateur : impossible de séparer les deux guitares (utilise Chrome)."
      } else if (channel.value === 'mix') {
        source.connect(addVoice(null))
      } else {
        const splitter = ctx.createChannelSplitter(2)
        source.connect(splitter)
        nodes.push(splitter)
        splitter.connect(addVoice(null), Number(channel.value))
      }

      running.value = true
      localStorage.setItem('fb.deviceId', deviceId.value)
      loop()
    } catch (e) {
      error.value =
        e.name === 'NotAllowedError'
          ? "Accès au micro refusé. Autorise l'accès dans les réglages du navigateur."
          : e.name === 'OverconstrainedError'
            ? 'Périphérique introuvable, sélectionne-en un autre.'
            : `Erreur audio : ${e.message}`
      stop()
    }
  }

  function stop() {
    cancelAnimationFrame(raf)
    nodes.forEach((n) => n.disconnect())
    nodes = []
    voices = []
    levels.value = [0, 0]
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    ctx?.close()
    ctx = null
    running.value = false
    level.value = 0
    frequency.value = null
    midiFloat.value = null
    current.value = null
  }

  function loop() {
    raf = requestAnimationFrame(loop)
    const now = performance.now()
    let heard = null
    const voiceLevels = voices.map((v) => {
      v.analyser.getFloatTimeDomainData(v.buffer)
      const out = v.tracker.process(v.buffer, now)
      if (out.freq !== null && !heard) heard = out
      return out.level
    })
    level.value = Math.max(0, ...voiceLevels)
    if (duo.value) levels.value = voiceLevels
    // Accordeur : la première voix qui joue
    frequency.value = heard?.freq ?? null
    midiFloat.value = heard?.midiFloat ?? null
    const note = voices.map((v) => v.tracker.current()).find(Boolean) ?? null
    if (note !== current.value) current.value = note
  }

  function setDevice(id) {
    deviceId.value = id
    localStorage.setItem('fb.deviceId', id)
    if (running.value) start()
  }

  function setChannel(c) {
    channel.value = c
    localStorage.setItem('fb.channel', c)
    if (running.value) start()
  }

  /** Mode deux guitares (relance l'écoute si elle tourne). */
  function setDuo(on) {
    if (duo.value === on) return
    duo.value = on
    if (running.value) start()
  }

  function setSensitivity(v) {
    sensitivity.value = v
    localStorage.setItem('fb.sensitivityPct', String(v))
  }

  if (navigator.mediaDevices) {
    refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
  } else {
    error.value = "Ce navigateur ne permet pas l'accès audio (utilise Chrome, Edge ou Firefox en localhost/HTTPS)."
  }

  onBeforeUnmount(() => {
    stop()
    navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
  })

  return {
    devices,
    deviceId,
    channel,
    duo,
    levels,
    channelCount,
    sensitivity,
    thresholdLevel,
    running,
    error,
    level,
    sampleRate,
    frequency,
    midiFloat,
    current,
    start,
    stop,
    setDevice,
    setChannel,
    setDuo,
    setSensitivity,
  }
}
