/**
 * Worker : rend l'accompagnement d'un morceau Guitar Pro en audio (banque de sons General MIDI d'alphaTab),
 * sans la piste jouée par le guitariste, à la vitesse demandée (tempo ralenti, hauteur inchangée).
 *
 * Message reçu : { cmd: 'fretboard.render', id, data (ArrayBuffer du fichier), soundFont (ArrayBuffer), trackIndex, speed, sampleRate,
 *                  synthDrums (batterie rendue à part par lib/drumSynth.js), range?: { startTick, endTick } }
 * Messages envoyés : { id, progress (0–1) } puis { id, done: true, left, right (Float32Array), frames, drums }
 */
import * as at from '@coderline/alphatab'
import { generateMidi } from './songChart'

const DRUM_CHANNEL = 9
const CMD = 'fretboard.render' // alphaTab lit le champ cmd de tous les messages du worker
let soundFont = null // gardée entre deux rendus (changement de vitesse du Riff Repeater)

const noEvents = () => ({ on() {}, off() {} })
const silentOutput = (sampleRate) => ({
  sampleRate,
  open() {},
  play() {},
  destroy() {},
  pause() {},
  addSamples() {},
  resetSamples() {},
  activate() {},
  ready: noEvents(),
  samplesPlayed: noEvents(),
  sampleRequest: noEvents(),
  enumerateOutputDevices: async () => [],
  setOutputDevice: async () => {},
  getOutputDevice: async () => null,
})

self.onmessage = ({ data: msg }) => {
  if (msg?.cmd !== CMD) return // alphaTab installe aussi son propre écouteur de messages dans les workers
  try {
    if (msg.soundFont) soundFont = new Uint8Array(msg.soundFont)
    const settings = new at.Settings()
    const score = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(msg.data), settings)
    // Vitesse : tous les changements de tempo sont multipliés (le tempo initial est celui de la 1re mesure),
    // les notes gardent leur hauteur
    const first = score.masterBars[0]
    if (first && !first.tempoAutomations.length) first.tempoAutomations.push(at.model.Automation.buildTempoAutomation(false, 0, 120, 0))
    for (const mb of score.masterBars) for (const a of mb.tempoAutomations) a.value *= msg.speed
    const { midi, secondsAt } = generateMidi(at, score, settings)

    const options = new at.synth.AudioExportOptions()
    options.soundFonts = [soundFont]
    options.sampleRate = msg.sampleRate
    options.masterVolume = 0.9
    const volumes = new Map()
    const player = score.tracks[msg.trackIndex]?.playbackInfo
    if (player) volumes.set(player.primaryChannel, 0).set(player.secondaryChannel, 0)
    // Canaux de la batterie : le canal 10 General MIDI, plus ceux des pistes de percussion du fichier
    const drumChannels = new Set([DRUM_CHANNEL])
    for (const t of score.tracks) if (t.isPercussion) drumChannels.add(t.playbackInfo.primaryChannel).add(t.playbackInfo.secondaryChannel)
    if (msg.synthDrums) for (const c of drumChannels) volumes.set(c, 0)
    options.trackVolume = volumes
    options.trackTranspositionPitches = new Map()
    if (msg.range) options.playbackRange = msg.range

    // Batterie synthétisée : on renvoie les coups, datés à cette vitesse
    const drums = []
    if (msg.synthDrums) {
      const from = msg.range ? secondsAt(msg.range.startTick) : 0
      const to = msg.range ? secondsAt(msg.range.endTick) : Infinity
      for (const t of midi.tracks)
        for (const e of t.events)
          if (e instanceof at.midi.NoteOnEvent && drumChannels.has(e.channel) && e.noteVelocity > 0) {
            const time = secondsAt(e.tick)
            if (time >= from && time < to) drums.push({ time: time - from, key: e.noteKey, velocity: e.noteVelocity })
          }
    }

    const synth = new at.synth.AlphaSynth(silentOutput(msg.sampleRate), 500)
    const exporter = synth.exportAudio(options, midi, [], new Map())
    const total = msg.range ? secondsAt(msg.range.endTick) - secondsAt(msg.range.startTick) : secondsAt(midi.tracks.flatMap((t) => t.events).reduce((m, e) => Math.max(m, e.tick), 0))
    // Sortie écrite directement en deux canaux (une seule copie du son en mémoire), agrandie si besoin
    let capacity = Math.ceil((total + 4) * msg.sampleRate)
    let left = new Float32Array(capacity)
    let right = new Float32Array(capacity)
    let frames = 0
    let chunk
    let lastProgress = 0
    while ((chunk = exporter.render(2000))) {
      const s = chunk.samples // stéréo entrelacé
      const n = s.length / 2
      if (frames + n > capacity) {
        capacity = Math.ceil((frames + n) * 1.25)
        const l = new Float32Array(capacity)
        const r = new Float32Array(capacity)
        l.set(left.subarray(0, frames))
        r.set(right.subarray(0, frames))
        left = l
        right = r
      }
      for (let i = 0; i < n; i++) {
        left[frames + i] = s[i * 2]
        right[frames + i] = s[i * 2 + 1]
      }
      frames += n
      const progress = Math.min(1, frames / msg.sampleRate / Math.max(1, total))
      if (progress - lastProgress > 0.04) {
        self.postMessage({ id: msg.id, progress })
        lastProgress = progress
      }
    }
    self.postMessage({ id: msg.id, done: true, left, right, frames, drums }, [left.buffer, right.buffer])
  } catch (e) {
    self.postMessage({ id: msg.id, error: e?.message ?? String(e) })
  }
}
