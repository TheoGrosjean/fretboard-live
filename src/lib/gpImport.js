/**
 * Import d'une tablature Guitar Pro (.gp, .gpx, .gp5, .gp4, .gp3) dans les phrasés : on choisit une piste
 * et des mesures, elles deviennent un phrasé à travailler comme les autres.
 *
 * Lecture du fichier par alphaTab, chargé seulement à l'import (la bibliothèque est lourde).
 * Mesures prises telles qu'écrites (sans les reprises). Une note par instant, comme partout dans les phrasés :
 * d'un accord, on garde la plus grave (un power chord reste un power chord). Notes étouffées (x) et
 * notes d'ornement ignorées, notes liées fusionnées, harmoniques notées à la hauteur de la case.
 * Cordes : 0 = Mi aigu … (comme le manche du site) ; alphaTab numérote 1 = la plus grave.
 */
import { GRID_MIX, onGrid, snapBeat, uid } from './phrases'

export const GP_ACCEPT = '.gp,.gpx,.gp5,.gp4,.gp3'
export const isGpFile = (file) => /\.(gp|gpx|gp[345])$/i.test(file.name)
export const MAX_IMPORT_BARS = 32 // comme un phrasé
const TICKS = 960 // ticks par noire chez alphaTab
const fullBar = (mb) => (mb.timeSignatureNumerator * 4 * TICKS) / mb.timeSignatureDenominator // durée d'une mesure complète, en ticks

let lib = null
/** Partition lue dans le fichier (lève une erreur si le fichier n'est pas une tablature lisible). */
export async function readScore(file) {
  lib ??= await import('@coderline/alphatab')
  return lib.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()), new lib.Settings())
}

const isVocal = (name) => /vocal|voice|voix|chant|lyric/i.test(name)
const playedNotes = (beat) => (beat.isRest || beat.graceType ? [] : beat.notes.filter((n) => !n.isDead))
const pitch = (n) => n.realValueWithoutHarmonic
const barNotes = (bar) => bar.voices.flatMap((v) => v.beats.flatMap((b) => playedNotes(b).map((n) => ({ beat: b, n }))))

/** Pistes de guitare (6 cordes ou plus) qui ont des notes : [{ index, name, tuning, notes }], la plus probable en premier. */
export function guitarTracks(score) {
  const list = score.tracks
    .map((t, index) => ({ index, name: t.name?.trim() || `Piste ${index + 1}`, tuning: [...(t.staves[0]?.tuning ?? [])], notes: t.isPercussion ? 0 : (t.staves[0]?.bars ?? []).reduce((sum, bar) => sum + barNotes(bar).length, 0) }))
    .filter((t) => t.tuning.length >= 6 && t.notes > 0)
  return [...list.filter((t) => !isVocal(t.name)), ...list.filter((t) => isVocal(t.name))]
}

/** Mesures de la piste pour l'aperçu : [{ index, section, dots: [{ x, y }] }] (x, y dans [0, 1]). */
export function barOverview(score, trackIndex) {
  const staff = score.tracks[trackIndex].staves[0]
  const all = staff.bars.flatMap(barNotes).map(({ n }) => pitch(n))
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  return score.masterBars.map((mb, i) => {
    const length = mb.calculateDuration()
    const bar = staff.bars[i]
    const dots = bar ? barNotes(bar).map(({ beat, n }) => ({ x: beat.playbackStart / length, y: hi === lo ? 0.5 : (pitch(n) - lo) / (hi - lo) })) : []
    return { index: i, section: mb.section?.text?.trim() || '', dots }
  })
}

/** Sections repérées dans le fichier (Intro, Couplet, Solo…) : [{ name, from, to }] en indices de mesures. */
export function scoreSections(score) {
  const starts = score.masterBars.filter((mb) => mb.section).map((mb) => ({ name: mb.section.text?.trim() || `Mesure ${mb.index + 1}`, from: mb.index }))
  return starts.map((s, k) => ({ ...s, to: (starts[k + 1]?.from ?? score.masterBars.length) - 1 }))
}

/** Tempo (à la noire) en vigueur au début de la mesure `index`. */
function tempoAt(score, index) {
  let bpm = score.tempo || 120
  for (const mb of score.masterBars.slice(0, index + 1)) {
    const last = mb.tempoAutomations?.at(-1)
    if (last) bpm = last.value
  }
  return bpm
}

/** Les notes d'un temps réduites à une seule : la plus grave, en power chord si l'accord en a la forme. */
function oneOf(notes) {
  const sorted = [...notes].sort((a, b) => pitch(a) - pitch(b))
  const root = sorted[0]
  const intervals = new Set(sorted.slice(1).map((n) => pitch(n) - pitch(root)))
  const power = intervals.has(7) && [...intervals].every((iv) => iv === 7 || iv === 12)
  return { n: root, power }
}

/**
 * Phrasé tiré des mesures `from` à `to` (incluses) de la piste : { name, beats, grid, bpm, lengthBeats, notes, snapped }.
 * tuning : accordage du manche du site (le doigté de la tablature est gardé s'il est le même).
 */
export function phraseFromBars(score, trackIndex, from, to, tuning) {
  const track = score.tracks[trackIndex]
  const staff = track.staves[0]
  const tabTuning = [...staff.tuning]
  const strings = tabTuning.length
  const sameTuning = strings === tuning.length && tabTuning.every((m, i) => m === tuning[i])
  const bars = score.masterBars.slice(from, to + 1)
  // Unité de temps : la noire, sauf mesure qui n'en contient pas un nombre entier (7/8…) : la croche
  const unit = bars.every((mb) => fullBar(mb) % TICKS === 0) ? 1 : 0.5
  const toBeats = (ticks) => ticks / TICKS / unit
  const { SlideOutType } = lib.model
  const slideTo = new Set() // notes atteintes en glissant depuis la précédente
  const emitted = new Map() // note alphaTab -> note du phrasé (pour prolonger les notes liées)
  const notes = []
  // Mesure de levée (anacrouse) : ses notes tombent à la fin d'une mesure complète
  let offset = bars[0].isAnacrusis ? toBeats(fullBar(bars[0]) - bars[0].calculateDuration()) : 0
  for (const mb of bars) {
    const bar = staff.bars[mb.index]
    const beatsInBar = bar ? [...new Set(bar.voices.flatMap((v) => v.beats))].sort((a, b) => a.playbackStart - b.playbackStart) : []
    for (const beat of beatsInBar) {
      const played = playedNotes(beat)
      if (!played.length) continue
      const start = offset + toBeats(beat.playbackStart)
      const end = offset + toBeats(beat.playbackStart + beat.playbackDuration)
      const fresh = []
      for (const n of played) {
        const origin = n.isTieDestination && emitted.get(n.tieOrigin)
        if (origin) {
          origin.dur = end - origin.beat
          emitted.set(n, origin)
        } else fresh.push(n)
        if ((n.slideOutType === SlideOutType.Shift || n.slideOutType === SlideOutType.Legato) && n.slideTarget) slideTo.add(n.slideTarget)
      }
      if (!fresh.length) continue
      const { n, power } = oneOf(fresh)
      const maxBend = n.hasBend && n.bendPoints?.length ? Math.max(...n.bendPoints.map((p) => p.value)) : 0
      const bend = Math.round(maxBend / 2) // alphaTab compte en quarts de ton
      const note = {
        id: uid(),
        midi: pitch(n),
        beat: start,
        dur: end - start,
        ...(sameTuning && { string: strings - n.string, fret: n.fret, locked: true }),
        ...(n.isHammerPullDestination && { tech: 'legato', legato: true }),
        ...(slideTo.has(n) && { tech: 'slide' }),
        ...(bend > 0 && { bend, release: n.bendPoints.at(-1).value < maxBend }),
        ...(power && { chord: 'power' }),
        ...(n.isPalmMute && { pm: true }),
      }
      notes.push(note)
      fresh.forEach((m) => emitted.set(m, note))
    }
    offset += toBeats(mb.calculateDuration())
  }

  // Grille : la plus simple qui tombe juste ; sinon la grille mixte, en arrondissant ce qui n'y tombe pas (triples croches…)
  const grid = [1, 2, 3, 4].find((g) => onGrid(notes, g)) ?? GRID_MIX
  const snapped = !onGrid(notes, grid)
  if (snapped) notes.forEach((n) => (n.beat = snapBeat(n.beat, GRID_MIX)))

  const first = bars[0]
  const beats = (first.timeSignatureNumerator * 4) / first.timeSignatureDenominator / unit
  const title = score.title?.trim() || 'Tablature'
  const section = scoreSections(score).find((s) => s.from === from && s.to === to)?.name
  return {
    name: `${title} · ${section ?? (from === to ? `mes. ${from + 1}` : `mes. ${from + 1}–${to + 1}`)}`.slice(0, 60),
    beats,
    grid,
    bpm: Math.round(tempoAt(score, from) / unit),
    lengthBeats: Math.max(beats, Math.ceil(offset / beats - 1e-6) * beats),
    notes,
    snapped,
  }
}
