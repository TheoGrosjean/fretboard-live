/**
 * Lecture d'un morceau Guitar Pro : la partition est convertie en événements MIDI (alphaTab, avec reprises et
 * changements de tempo), puis rejouée en Web Audio. Pour l'instant : la batterie, synthétisée (lib/drumSynth.js).
 */
import { createDrumKit } from './drumSynth'

const DRUM_CHANNEL = 9 // canal 10 en General MIDI
const LOOKAHEAD = 0.15 // s : les coups sont programmés un peu en avance, pour un tempo parfaitement stable
const TICK_MS = 25

/** Partition → { duration, drums: [{ time, key, velocity }], notes: [{ time, midi, channel }] } (temps en secondes). */
export async function songTimeline(data) {
  const at = await import('@coderline/alphatab')
  const settings = new at.Settings()
  const score = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data), settings)
  const midi = new at.midi.MidiFile()
  const generator = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(midi))
  generator.generate()
  // Fin du morceau : fin de la dernière mesure jouée (reprises comprises), pas la fin des notes qui résonnent
  const endTick = generator.tickLookup.masterBars.at(-1)?.end ?? 0

  const events = midi.tracks.flatMap((t) => t.events).sort((a, b) => a.tick - b.tick)
  // Canaux de la batterie : le canal 10 General MIDI, plus ceux des pistes de percussion du fichier
  const drumChannels = new Set([DRUM_CHANNEL])
  for (const t of score.tracks) if (t.isPercussion) drumChannels.add(t.playbackInfo.primaryChannel).add(t.playbackInfo.secondaryChannel)
  // Ticks → secondes, en suivant les changements de tempo
  let tempoTick = 0
  let tempoTime = 0
  let bpm = score.tempo || 120
  const secondsAt = (tick) => tempoTime + ((tick - tempoTick) / midi.division) * (60 / bpm)
  const drums = []
  const notes = []
  for (const e of events) {
    if (e instanceof at.midi.TempoChangeEvent) {
      tempoTime = secondsAt(e.tick)
      tempoTick = e.tick
      bpm = e.beatsPerMinute
    } else if (e instanceof at.midi.NoteOnEvent && e.noteVelocity > 0) {
      const time = secondsAt(e.tick)
      if (drumChannels.has(e.channel)) drums.push({ time, key: e.noteKey, velocity: e.noteVelocity })
      else notes.push({ time, midi: e.noteKey, channel: e.channel })
    }
  }
  return { duration: secondsAt(endTick), drums, notes }
}

/** Lecteur : play(depuis), stop(), position() en secondes ; onEnd appelé en fin de morceau. */
export function createSongPlayer(timeline, { onEnd } = {}) {
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  let kit = null // recréé à chaque lecture : l'arrêt débranche l'ancien, avec les coups déjà programmés
  let startAt = 0 // temps du contexte correspondant au début du morceau
  let next = 0 // prochain coup à programmer
  let timer = 0

  function schedule() {
    const horizon = ctx.currentTime + LOOKAHEAD
    const drums = timeline.drums
    while (next < drums.length && startAt + drums[next].time < horizon) {
      const d = drums[next++]
      kit.hit(d.key, Math.max(ctx.currentTime, startAt + d.time), d.velocity)
    }
    if (ctx.currentTime - startAt > timeline.duration + 2) { // laisse résonner la dernière cymbale
      stop()
      onEnd?.()
    }
  }

  async function play(from = 0) {
    stop()
    await ctx.resume()
    kit = createDrumKit(ctx)
    startAt = ctx.currentTime + 0.1 - from
    next = timeline.drums.findIndex((d) => d.time >= from)
    if (next < 0) next = timeline.drums.length
    schedule()
    timer = setInterval(schedule, TICK_MS)
  }
  function stop() {
    clearInterval(timer)
    timer = 0
    kit?.destroy()
    kit = null
  }

  return {
    play,
    stop,
    playing: () => Boolean(timer),
    position: () => Math.max(0, ctx.currentTime - startAt),
    destroy() {
      stop()
      ctx.close()
    },
  }
}
