/**
 * Partition jouable d'une piste Guitar Pro, pour l'autoroute de notes (page Morceaux → Jouer).
 *
 * Les notes sont lues dans l'ordre réel de lecture (reprises comprises, via la table des ticks d'alphaTab)
 * et datées en secondes à vitesse normale ; à une autre vitesse, il suffit de diviser les temps.
 * Cordes : 0 = Mi aigu … 5 = Mi grave (comme le manche du site).
 *
 * Difficulté dynamique : chaque note reçoit un « palier » (tier) 0–3 selon son importance rythmique
 * (temps fort, contretemps, double-croche…) ; au niveau N, on n'affiche que les notes de palier < N.
 */

export const TICKS_PER_QUARTER = 960
export const LEVELS = 4 // niveau 4 = toutes les notes
const SECTION_BARS = 8 // sans repères dans le fichier : une section toutes les 8 mesures

/**
 * Couleurs des cordes (du Mi aigu au Mi grave) : celles de Rocksmith (violet, vert, orange, bleu, jaune, rouge),
 * franches pour se distinguer d'un coup d'œil, mais rendues mates (pas de lueur) sur l'autoroute.
 */
export const STRING_COLORS = ['#a78bfa', '#4ade80', '#fb923c', '#60a5fa', '#facc15', '#ef4444']

/** Pistes jouables (guitare / basse avec des notes). */
export const playableTracks = (score) => score.tracks.map((t, index) => ({ t, index })).filter(({ t }) => !t.isPercussion && t.staves[0]?.tuning?.length)

/** Génère le MIDI (reprises, tempo) : renvoie { midi, generator, secondsAt(tick) }. */
export function generateMidi(at, score, settings = new at.Settings()) {
  const midi = new at.midi.MidiFile()
  const generator = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(midi))
  generator.generate()
  const tempos = midi.tracks
    .flatMap((t) => t.events)
    .filter((e) => e instanceof at.midi.TempoChangeEvent)
    .sort((a, b) => a.tick - b.tick)
  // Table tick → secondes, segment par segment de tempo
  const segments = []
  let tick = 0
  let time = 0
  let bpm = score.tempo || 120
  for (const e of tempos) {
    time += ((e.tick - tick) / midi.division) * (60 / bpm)
    tick = e.tick
    bpm = e.beatsPerMinute
    segments.push({ tick, time, bpm })
  }
  if (!segments.length || segments[0].tick > 0) segments.unshift({ tick: 0, time: 0, bpm: score.tempo || 120 })
  const secondsAt = (t) => {
    let s = segments[0]
    for (const seg of segments) if (seg.tick <= t) s = seg
    return s.time + ((t - s.tick) / midi.division) * (60 / s.bpm)
  }
  return { midi, generator, secondsAt }
}

/** Palier d'importance d'une note selon sa place dans le temps (0 = temps fort … 3 = ornement). */
function tierFor(tickInBar, ticksPerBeat, durationTicks, beatsPerBar) {
  const inBeat = tickInBar % ticksPerBeat
  if (inBeat === 0) {
    const beatIndex = tickInBar / ticksPerBeat
    return beatIndex === 0 || (beatsPerBar % 2 === 0 && beatIndex === beatsPerBar / 2) || durationTicks >= ticksPerBeat * 2 ? 0 : 1
  }
  if (inBeat % (ticksPerBeat / 2) === 0) return 2
  return 3
}

/**
 * Partition de la piste `trackIndex` : { title, artist, track, tuning, duration, notes, chords, beats, sections }.
 * notes : [{ id, time, dur, string, fret, midi, tier, chord, bend, slide, hopo, vibrato, palmMute, dead, harmonic }]
 */
export function buildChart(at, score, trackIndex) {
  const track = score.tracks[trackIndex]
  const staff = track.staves[0]
  const tuning = [...staff.tuning] // du Mi aigu au Mi grave
  const strings = tuning.length
  const { generator, secondsAt } = generateMidi(at, score)

  const notes = []
  const chords = []
  const beats = []
  const sections = []
  let lastSectionBar = -SECTION_BARS
  let hasMarkers = score.masterBars.some((mb) => mb.section)
  let id = 0

  for (const mbl of generator.tickLookup.masterBars) {
    const mb = mbl.masterBar
    const ticksPerBeat = (TICKS_PER_QUARTER * 4) / mb.timeSignatureDenominator
    const start = secondsAt(mbl.start)
    // Grille : un trait par temps, plus marqué en début de mesure
    for (let k = 0; k < mb.timeSignatureNumerator; k++) beats.push({ time: secondsAt(mbl.start + k * ticksPerBeat), bar: k === 0, barNumber: mb.index + 1 })
    // Sections : repères du fichier, sinon toutes les 8 mesures
    if (mb.section || (!hasMarkers && mb.index - lastSectionBar >= SECTION_BARS) || !sections.length) {
      const name = mb.section?.text?.trim() || (hasMarkers ? 'Intro' : `Mesures ${mb.index + 1}–${mb.index + SECTION_BARS}`)
      sections.at(-1) && (sections.at(-1).end = start)
      sections.push({ index: sections.length, name, start, end: start, startTick: mbl.start, firstBar: mb.index + 1 })
      lastSectionBar = mb.index
    }

    const bar = staff.bars[mb.index]
    if (!bar) continue
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.isRest || !beat.notes.length) continue
        const tick = mbl.start + beat.playbackStart
        const time = secondsAt(tick)
        const dur = secondsAt(tick + beat.playbackDuration) - time
        const baseTier = tierFor(beat.playbackStart, ticksPerBeat, beat.playbackDuration, mb.timeSignatureNumerator)
        const played = beat.notes.filter((n) => !n.isTieDestination)
        if (!played.length) continue
        // Accord : notes groupées, la plus grave garde le palier du temps, les autres apparaissent un cran plus tard
        const ordered = [...played].sort((a, b) => a.string - b.string)
        const chordId = ordered.length > 1 ? `c${chords.length}` : null
        const ids = []
        ordered.forEach((n, i) => {
          const bendMax = n.hasBend && n.bendPoints?.length ? Math.max(...n.bendPoints.map((p) => p.value)) : 0
          const note = {
            id: id++,
            time,
            dur,
            string: strings - n.string,
            fret: n.fret,
            midi: n.realValue,
            tier: Math.min(3, baseTier + (i > 0 ? 1 : 0)),
            chord: chordId,
            bend: bendMax ? Math.round(bendMax / 2) : 0, // en demi-tons
            slide: n.slideOutType ? (n.slideTarget ? (n.slideTarget.fret > n.fret ? 'up' : 'down') : n.slideOutType === 5 ? 'down' : 'up') : null,
            slideTo: n.slideTarget?.fret ?? null,
            hopo: n.isHammerPullDestination && n.hammerPullOrigin ? (n.hammerPullOrigin.fret < n.fret ? 'H' : 'P') : null,
            vibrato: Boolean(n.vibrato),
            palmMute: n.isPalmMute,
            dead: n.isDead,
            harmonic: Boolean(n.harmonicType),
          }
          notes.push(note)
          ids.push(note.id)
        })
        if (chordId) chords.push({ id: chordId, time, dur, name: beat.chord?.name ?? '', noteIds: ids })
      }
    }
  }

  const lastBar = generator.tickLookup.masterBars.at(-1)
  const duration = lastBar ? secondsAt(lastBar.end) : 0
  if (sections.length) sections.at(-1).end = duration
  notes.sort((a, b) => a.time - b.time || a.string - b.string)
  return {
    title: score.title?.trim() || '',
    artist: score.artist?.trim() || '',
    track: track.name?.trim() || `Piste ${trackIndex + 1}`,
    tuning,
    duration,
    notes,
    chords,
    beats,
    sections,
  }
}

/** Accordage lisible : « Standard », « Drop D »… ou la liste des notes. */
export function tuningName(tuning) {
  const std = [64, 59, 55, 50, 45, 40]
  if (tuning.length === 6) {
    const diff = tuning.map((m, i) => m - std[i])
    if (diff.every((d) => d === 0)) return 'Standard'
    if (diff.every((d, i) => (i === 5 ? d === -2 : d === 0))) return 'Drop D'
    if (diff.every((d) => d === diff[0])) return `Standard ${diff[0] > 0 ? '+' : ''}${diff[0]} demi-ton${Math.abs(diff[0]) > 1 ? 's' : ''}`
  }
  const names = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
  return [...tuning].reverse().map((m) => names[m % 12]).join(' ')
}
