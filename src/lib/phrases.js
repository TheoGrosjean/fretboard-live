/**
 * Phrasés personnels : enregistrés à la guitare, puis travaillés en boucle en montant le tempo.
 *
 * Un phrasé = des notes placées sur une grille rythmique (en temps depuis le début : 0, 0.25, 0.5…),
 * avec leur position sur le manche (devinée par le doigté, corrigeable à la main).
 * À l'entraînement, seules la hauteur et le moment comptent : la corde jouée n'est pas vérifiable
 * avec un seul micro.
 *
 * Ce fichier : le modèle (et sa migration), la sauvegarde, la grille, le doigté, les techniques.
 * Le rythme (calage, prise libre) est dans phraseRhythm.js, l'entraînement dans phraseCoach.js.
 */
import { bestFingering } from './fingering'
import { findPositions } from './music'

const STORAGE_KEY = 'fb.phrases'
export const PHRASE_VERSION = 2
export const uid = () => Math.random().toString(36).slice(2, 10)

export function loadPhrases() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []
    return Array.isArray(list) ? list.map(migratePhrase) : []
  } catch {
    return []
  }
}
export function savePhrases(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* stockage plein ou bloqué : le phrasé reste en mémoire */
  }
}

/** Réglages de progression par défaut d'un phrasé enregistré à `bpm`. */
const progression = (bpm) => ({
  startBpm: Math.max(40, bpm - 20),
  targetBpm: Math.min(240, bpm + 30),
  bpm: Math.max(40, bpm - 20), // tempo où on en est
})

/** Nouveau phrasé vide, au tempo et à la mesure du métronome. */
export function newPhrase({ name, bpm, beats, grid }) {
  return migratePhrase({
    id: uid() + Date.now().toString(36),
    name,
    createdAt: Date.now(),
    beats, // temps par mesure
    grid, // grille : subdivisions par temps (1, 2, 3, 4) ou GRID_MIX
    lengthBeats: beats, // durée d'une boucle, en temps (mesures entières)
    notes: [],
    recordBpm: bpm,
    ...progression(bpm),
  })
}

/**
 * Remet un phrasé (d'une ancienne version, ou importé) au format courant, sans perdre ce qu'il contient.
 * notes : [{ id, midi, beat, dur?, raw?, string, fret, locked?, legato?, tech?, bend?, release?, chord? }]
 */
export function migratePhrase(p) {
  const out = {
    method: p.auto === false ? 'manual' : 'ladder', // méthode de progression (voir phraseCoach.METHODS)
    step: 5, // BPM gagnés à chaque palier
    reps: 3, // passages propres d'affilée pour monter
    rest: 1, // mesures de pause entre deux passages
    burst: 15, // méthode Rafales : % de vitesse en plus un passage sur deux
    bestBpm: 0, // meilleur tempo réussi proprement
    zone: null, // case autour de laquelle placer le doigté (null : là où c'est le plus jouable)
    loop: null, // section travaillée en boucle : { from, to } en temps, ou null pour tout le phrasé
    sessions: [], // [{ at, duration, passes, clean, bestBpm, maxBpm, startBpm }]
    noteStats: {}, // par note (id) : réussite et timing, moyennés au fil des passages
    review: null, // révision espacée : { due, interval, ease, reps, last, q }
    ...p,
    v: PHRASE_VERSION,
  }
  delete out.auto
  out.notes = (p.notes ?? []).map(sanitizeNote).filter(Boolean)
  out.sessions = (p.sessions ?? []).map((s) => ({ duration: 0, maxBpm: s.bestBpm ?? 0, ...s }))
  out.updatedAt ??= out.createdAt ?? Date.now()
  return out
}

const finite = (v, fallback = undefined) => (Number.isFinite(v) ? v : fallback)
function sanitizeNote(n) {
  const midi = finite(n?.midi)
  const beat = finite(n?.beat)
  if (midi === undefined || beat === undefined || midi < 16 || midi > 120) return null
  const out = { ...n, id: n.id ?? uid(), midi: Math.round(midi), beat: Math.max(0, beat) }
  for (const key of ['dur', 'raw', 'string', 'fret']) if (out[key] !== undefined && !Number.isFinite(out[key])) delete out[key]
  return out
}

// ---------- Sauvegarde dans un fichier (partager, changer d'ordinateur) ----------

export const exportPhrases = (list) => JSON.stringify({ app: 'fretboard-live', kind: 'phrases', version: PHRASE_VERSION, phrases: list }, null, 2)

/** Phrasés lus dans un fichier exporté (nouveaux identifiants : rien n'écrase la bibliothèque). */
export function importPhrases(text) {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : data?.phrases
  if (!Array.isArray(list)) throw new Error('Fichier sans phrasés')
  return list
    .filter((p) => p && Array.isArray(p.notes))
    .map((p) => migratePhrase({ ...p, id: uid() + Date.now().toString(36), name: String(p.name ?? 'Phrasé importé').slice(0, 60), review: null }))
}

// ---------- Grille rythmique ----------

export const GRID_MIX = 12 // grille mixte : doubles croches et triolets dans le même phrasé
export const GRIDS = [
  { n: 1, name: 'Noires' },
  { n: 2, name: 'Croches' },
  { n: 3, name: 'Triolets' },
  { n: 4, name: 'Doubles croches' },
  { n: GRID_MIX, name: 'Mixte' },
]
export const gridName = (n) => GRIDS.find((g) => g.n === n)?.name ?? ''
const MIX_SLOTS = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1] // positions possibles dans un temps, en grille mixte

/** Place un instant (en temps) sur la grille. */
export function snapBeat(beat, grid) {
  if (grid !== GRID_MIX) return Math.max(0, Math.round(beat * grid) / grid)
  const k = Math.floor(beat)
  const f = beat - k
  return Math.max(0, k + MIX_SLOTS.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a)))
}
export const quantize = snapBeat

/** Plus petite case de la grille (durée minimale d'une note). */
export const gridStep = (grid) => (grid === GRID_MIX ? 1 / 4 : 1 / grid)

/** Case suivante (dir = 1) ou précédente (dir = -1) sur la grille. */
export function stepBeat(beat, dir, grid) {
  if (grid !== GRID_MIX) return Math.round((beat + dir / grid) * grid) / grid
  const k = Math.floor(beat + 1e-9)
  const f = beat - k
  if (dir > 0) return k + MIX_SLOTS.find((s) => s > f + 1e-6)
  const s = [...MIX_SLOTS].reverse().find((x) => x < f - 1e-6)
  return s === undefined ? k - 1 / 4 : k + s
}

/** Subdivision à dessiner pour un temps, d'après les notes qu'il contient (fractions dans [0, 1[). */
export function beatSubdivision(fractions, grid) {
  if (grid !== GRID_MIX) return grid
  const on = (g) => fractions.every((f) => Math.abs(f * g - Math.round(f * g)) < 1e-6)
  if (on(4)) return 4
  if (on(3)) return 3
  return on(6) ? 6 : 12
}

/**
 * Durée affichée d'une note : sa durée tenue (dur), sans déborder sur la note suivante ; sans durée connue
 * (anciens enregistrements), jusqu'à la note suivante, et un temps au plus pour la dernière.
 */
export function noteLength(notes, i, end) {
  const n = notes[i]
  const next = notes.find((m) => m.beat > n.beat + 1e-6)?.beat
  const room = (next ?? end) - n.beat
  return Math.max(0, n.dur !== undefined ? Math.min(n.dur, room) : next !== undefined ? room : Math.min(room, 1))
}

/** Durée de la boucle : mesures entières qui contiennent toutes les notes (au moins une). */
export function loopLength(notes, beats, grid) {
  if (!notes.length) return beats
  const end = Math.max(...notes.map((n) => n.beat + Math.max(n.dur ?? 0, gridStep(grid))))
  return Math.max(1, Math.ceil(end / beats - 1e-6)) * beats
}

// ---------- Doigté ----------

/**
 * Doigté du phrasé entier : chaque note reçoit une corde / case jouable (voir lib/fingering.js).
 * Les notes corrigées à la main (locked) gardent leur position et guident les autres.
 * zone : case autour de laquelle garder la main (null : laisser le doigté choisir).
 */
export function placeNotes(notes, tuning, frets, { zone = null } = {}) {
  const sorted = [...notes].sort((a, b) => a.beat - b.beat)
  const input = sorted.map((n) => {
    const fits = n.locked && n.string !== undefined && n.string < tuning.length && tuning[n.string] + n.fret === n.midi
    let candidates = fits ? [{ string: n.string, fret: n.fret }] : findPositions(n.midi, tuning, frets)
    // Power chord : la fondamentale doit laisser la place à la quinte sur la corde du dessus
    if (n.chord === 'power' && !fits) {
      const roomy = candidates.filter((c) => powerShape({ midi: n.midi, ...c }, tuning, frets).length)
      if (roomy.length) candidates = roomy
    }
    return { candidates, legato: n.tech === 'slide' ? 'slide' : !!n.legato || n.tech === 'legato' }
  })
  if (!input.every((n) => n.candidates.length)) return sorted // note hors du manche (autre accordage) : on ne touche à rien
  const path = bestFingering(input, null, zone !== null ? { fret: zone, string: 3 } : null)
  return sorted.map((n, i) => ({ ...n, string: path[i].string, fret: path[i].fret }))
}

/** Zones proposées pour le doigté : la main autour d'une case. */
export const ZONES = [
  { fret: null, label: 'Auto' },
  { fret: 2, label: 'Cases 0–4' },
  { fret: 5, label: 'Cases 3–7' },
  { fret: 7, label: 'Cases 5–9' },
  { fret: 9, label: 'Cases 7–11' },
  { fret: 12, label: 'Cases 10–14' },
  { fret: 15, label: 'Cases 13–17' },
]

/** Contour mélodique pour une vignette : points { x, y } dans [0, 1]. */
export function contour(notes, lengthBeats) {
  if (!notes.length) return []
  const lo = Math.min(...notes.map((n) => n.midi))
  const hi = Math.max(...notes.map((n) => n.midi))
  return notes.map((n) => ({ x: n.beat / Math.max(lengthBeats, 1), y: hi === lo ? 0.5 : (n.midi - lo) / (hi - lo) }))
}

// ---------- Techniques ----------
// Sur chaque note : tech 'legato' (hammer-on / pull-off selon le sens) ou 'slide' depuis la note précédente,
// bend (demi-tons de tiré : 1 = ½ ton, 2 = 1 ton, 3 = 1 ton ½), release (le bend redescend),
// chord 'power' (power chord : fondamentale + quinte + octave ; seule la fondamentale est notée).

const BEND_LABELS = { 1: '½', 2: '1', 3: '1½' }
export const bendLabel = (steps) => BEND_LABELS[steps] ?? `${steps / 2}`

/** Technique de la note i, telle qu'on l'écrit sur une tablature : { kind, tag } ou null. */
export function techOf(notes, i) {
  const n = notes[i]
  const prev = notes[i - 1]
  if (n.bend) return { kind: 'bend', tag: `b${bendLabel(n.bend)}${n.release ? 'r' : ''}` }
  if (n.tech === 'slide' && prev) return { kind: 'slide', tag: n.midi > prev.midi ? '/' : '\\' }
  if (n.tech === 'legato' && prev) return n.midi > prev.midi ? { kind: 'hammer', tag: 'h' } : { kind: 'pull', tag: 'p' }
  return null
}

/** Autres cases d'un power chord posé sur { midi, string, fret } : quinte (corde du dessus), octave si possible. */
export function powerShape(root, tuning, frets) {
  const out = []
  for (const [interval, offset] of [
    [7, 1],
    [12, 2],
  ]) {
    const string = root.string - offset // les cordes plus aiguës ont un indice plus petit
    if (string < 0) break
    const fret = root.midi + interval - tuning[string]
    if (fret < 0 || fret > frets) break
    out.push({ string, fret })
  }
  return out
}
