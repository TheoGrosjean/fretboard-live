import { computed, ref, shallowRef, onBeforeUnmount } from 'vue'
import { createYinDetector } from '../lib/pitch'
import { freqToMidi } from '../lib/music'
import { isSlide } from '../lib/combo'

const STABLE_FRAMES = 3 // nombre de trames identiques avant de valider une note
const RELEASE_MS = 120 // silence nécessaire avant de considérer la note terminée
// Changement de note sans nouvelle attaque (slide, bend, legato) : la note doit tenir plus longtemps,
// pour ignorer les notes traversées pendant un slide
const LEGATO_STABLE_MS = 110

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
 * Capture l'entrée audio (ex. Focusrite Scarlett), détecte la hauteur en temps réel
 * et émet un événement à chaque nouvelle note jouée.
 */
export function useAudioInput({ onNote } = {}) {
  const devices = ref([])
  const deviceId = ref(localStorage.getItem('fb.deviceId') || '')
  const channel = ref(localStorage.getItem('fb.channel') || 'mix') // 'mix' | '0' | '1'
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
  let analyser = null
  let buffer = null
  let detect = null
  let raf = 0

  let candidate = null
  let candidateCount = 0
  let candidateSince = 0
  let attackPending = false // une attaque a eu lieu depuis la dernière note émise
  let swept = new Set() // demi-tons entendus depuis la dernière note émise (pour reconnaître un slide)
  let lastSoundAt = 0
  let smoothedRms = 0

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
      analyser = ctx.createAnalyser()
      analyser.fftSize = ctx.sampleRate > 50000 ? 4096 : 2048
      nodes = [source, analyser]

      if (channel.value === 'mix') {
        source.connect(analyser)
      } else {
        const splitter = ctx.createChannelSplitter(2)
        source.connect(splitter)
        splitter.connect(analyser, Number(channel.value))
        nodes.push(splitter)
      }

      buffer = new Float32Array(analyser.fftSize)
      detect = createYinDetector(ctx.sampleRate, analyser.fftSize)
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
    analyser.getFloatTimeDomainData(buffer)

    let sum = 0
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
    const rms = Math.sqrt(sum / buffer.length)
    level.value = meterPosition(toDb(rms))
    const now = performance.now()

    // Attaque : forte hausse du volume => nouvelle note même si identique
    const attack = rms > smoothedRms * 1.8 && rms > threshold.value * 2
    smoothedRms = smoothedRms * 0.8 + rms * 0.2
    if (attack) {
      attackPending = true
      swept = new Set()
    }

    const result = rms > threshold.value ? detect(buffer) : null
    if (!result) {
      frequency.value = null
      midiFloat.value = null
      if (now - lastSoundAt > RELEASE_MS) {
        current.value = null
        candidate = null
        candidateCount = 0
        swept = new Set()
      }
      return
    }

    lastSoundAt = now
    const m = freqToMidi(result.freq)
    frequency.value = result.freq
    midiFloat.value = m
    const rounded = Math.round(m)
    swept.add(rounded)

    if (rounded === candidate) candidateCount++
    else {
      candidate = rounded
      candidateCount = 1
      candidateSince = now
    }

    const previous = current.value
    // Note attaquée (ou première note après un silence) : validation rapide ; sinon on attend qu'elle tienne
    const legato = Boolean(previous) && !attackPending
    const stable = legato ? candidateCount >= STABLE_FRAMES && now - candidateSince >= LEGATO_STABLE_MS : candidateCount >= STABLE_FRAMES
    if (stable) {
      const isNew = !previous || previous.midi !== rounded || attack
      current.value = { midi: rounded, freq: result.freq, cents: (m - rounded) * 100 }
      if (isNew) {
        // Grand glissé sans nouvelle attaque, en passant par les cases intermédiaires
        const slide = legato && isSlide(previous.midi, rounded, swept) ? { from: previous.midi, to: rounded } : null
        onNote?.({ ...current.value, legato, slide })
        attackPending = false
        swept = new Set([rounded])
      }
    }
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
    setSensitivity,
  }
}
