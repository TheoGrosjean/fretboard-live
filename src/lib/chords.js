/**
 * Accords : formes jouables sur le manche (système CAGED) et accords d'une gamme.
 *
 * Les formes ne sont pas écrites à la main : pour chaque position de la main (4 cases), on cherche les
 * doigtés possibles (une note ou rien par corde), on garde ceux qui sont jouables (basse = tonique, toutes
 * les notes de l'accord, 4 doigts au plus en comptant le barré), puis on retient le meilleur doigté de chaque
 * forme CAGED. Le résultat a la même structure que les boxes de gamme (voir lib/boxes.js), pour réutiliser
 * l'affichage « Position » et le placement des notes jouées.
 */
import { pitchClass } from './music.js'

export const CHORDS = [
  { id: 'maj', name: 'Majeur', symbol: '', intervals: [0, 4, 7] },
  { id: 'min', name: 'Mineur', symbol: 'm', intervals: [0, 3, 7] },
  { id: '7', name: '7 (dominante)', symbol: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', name: 'maj7', symbol: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'm7', name: 'm7', symbol: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'sus2', name: 'Sus2', symbol: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', name: 'Sus4', symbol: 'sus4', intervals: [0, 5, 7] },
  { id: 'dim', name: 'Diminué', symbol: '°', intervals: [0, 3, 6] },
  { id: '5', name: 'Power chord (5)', symbol: '5', intervals: [0, 7], power: true },
]

const SPAN = 4 // cases couvertes par la main
const OPEN_MAX_POSITION = 2 // cordes à vide seulement près du sillet…
const OPEN_MAX_FRET = 3 // …dans un accord ouvert (sinon : doigtés hybrides peu naturels)
const MAX_FINGERS = 4

/**
 * Forme CAGED d'un doigté, d'après la corde de la basse et la place de la tonique dans la forme :
 * tonique sur le Mi grave tenue par le barré = forme de Mi (E), plus haut que le reste = forme de Sol (G) ;
 * même chose sur La : A ou C ; tonique sur Ré = forme de Ré (D).
 */
function cagedName(bass, frets) {
  const fretted = frets.filter((f) => f > 0)
  const low = fretted.length ? Math.min(...fretted) : 0
  const atBottom = frets[bass] === 0 || frets[bass] <= low
  if (bass === 5) return atBottom ? 'E' : 'G'
  if (bass === 4) return atBottom ? 'A' : 'C'
  return 'D'
}

/** Doigts nécessaires : un barré (index sur la case la plus basse) compte pour un seul doigt. */
function fingersNeeded(frets) {
  const fretted = frets.map((f, s) => ({ f, s })).filter((n) => n.f > 0)
  if (!fretted.length) return 0
  const low = Math.min(...fretted.map((n) => n.f))
  const onLow = fretted.filter((n) => n.f === low)
  if (onLow.length < 2) return fretted.length
  // Barré possible si aucune corde entre ses deux bouts n'est à vide ou étouffée
  const lo = Math.min(...onLow.map((n) => n.s))
  const hi = Math.max(...onLow.map((n) => n.s))
  for (let s = lo; s <= hi; s++) if (!(frets[s] >= low)) return fretted.length
  return fretted.length - onLow.length + 1
}

/** Note d'un doigté (plus c'est haut, mieux c'est) ; null s'il n'est pas jouable. */
function scoreVoicing(frets, tuning, root, chord) {
  const sounding = frets.map((f, s) => (f >= 0 ? s : -1)).filter((s) => s >= 0)
  if (!sounding.length) return null
  const bass = Math.max(...sounding)
  if (pitchClass(tuning[bass] + frets[bass]) !== root) return null
  const count = sounding.length
  const top = Math.min(...sounding)
  const inner = bass - top + 1 - count // cordes étouffées au milieu
  if (chord.power) {
    if (count < 2 || count > 3 || inner || bass < tuning.length - 3) return null // basse sur Mi, La ou Ré
  } else if (count < 3 || inner > 1) return null

  const pcs = new Set(sounding.map((s) => pitchClass(tuning[s] + frets[s])))
  const missing = chord.intervals.filter((i) => !pcs.has((root + i) % 12))
  // On peut omettre la quinte d'un accord de 4 sons, rien d'autre
  if (missing.some((i) => i !== 7) || (missing.length && chord.intervals.length < 4)) return null
  if (fingersNeeded(frets) > MAX_FINGERS) return null
  const opens = sounding.filter((s) => frets[s] === 0).length
  if (opens && Math.max(...frets) > OPEN_MAX_FRET) return null

  return count * 3 - inner * 5 - missing.length * 2 + opens * 0.5 - fingersNeeded(frets) * 0.3 - (count < 4 && !chord.power ? 3 : 0)
}

/**
 * Formes de l'accord `chord` (voir CHORDS) de tonique `root`, de la plus grave à la plus aiguë.
 * Renvoie [{ index, name, frets, muted, keys, ranges, minFret, maxFret, center }] ;
 * frets[s] = case de la corde s (0 = à vide, -1 = étouffée), cordes de l'aiguë (0) à la grave.
 */
export function chordShapes(root, chord, tuning, maxFret) {
  if (!chord) return []
  const pcs = new Set(chord.intervals.map((i) => (root + i) % 12))
  const best = new Map() // forme CAGED -> { frets, score, position }
  const frets = new Array(tuning.length).fill(-1)

  for (let position = 1; position + SPAN - 1 <= Math.min(maxFret, 15); position++) {
    const options = tuning.map((open) => {
      const o = [-1]
      if (position <= OPEN_MAX_POSITION && pcs.has(pitchClass(open))) o.push(0)
      for (let f = position; f < position + SPAN; f++) if (pcs.has(pitchClass(open + f))) o.push(f)
      return o
    })
    const walk = (s) => {
      if (s === tuning.length) {
        const fretted = frets.filter((f) => f > 0)
        if (!fretted.length || Math.min(...fretted) !== position) return // chaque doigté une seule fois
        const score = scoreVoicing(frets, tuning, root, chord)
        if (score === null) return
        const bass = frets.reduce((b, f, i) => (f >= 0 ? i : b), -1)
        const name = chord.power ? ['E', 'A', 'D'][5 - bass] ?? 'D' : cagedName(bass, frets)
        const prev = best.get(name)
        if (!prev || score > prev.score + 1e-9) best.set(name, { frets: [...frets], score, position })
        return
      }
      for (const f of options[s]) {
        frets[s] = f
        walk(s + 1)
      }
      frets[s] = -1
    }
    walk(0)
  }

  return [...best.entries()]
    .map(([name, v]) => {
      const played = v.frets.map((f, string) => ({ string, fret: f })).filter((p) => p.fret >= 0)
      const lo = Math.min(...played.map((p) => p.fret))
      const hi = Math.max(...played.map((p) => p.fret))
      return {
        name,
        frets: v.frets,
        muted: v.frets.map((f, s) => (f < 0 ? s : -1)).filter((s) => s >= 0),
        keys: new Set(played.map((p) => `${p.string}-${p.fret}`)),
        ranges: [[lo, hi]],
        minFret: lo,
        maxFret: hi,
        center: { fret: (lo + hi) / 2, string: (tuning.length - 1) / 2 },
      }
    })
    .sort((a, b) => a.minFret - b.minFret || a.maxFret - b.maxFret)
    .map((shape, index) => ({ ...shape, index }))
}

// ---------- Accords d'une gamme ----------
const PARENT = { 'penta-minor': [0, 2, 3, 5, 7, 8, 10], 'penta-major': [0, 2, 4, 5, 7, 9, 11] } // gamme complète
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
const TRIADS = { '4,7': 'maj', '3,7': 'min', '3,6': 'dim', '4,8': 'aug' }

/**
 * Accords construits sur chaque degré de la gamme (triades par empilement de tierces) ;
 * blues : I7, IV7, V7. Gammes symétriques (par tons, diminuée) : aucun.
 * Renvoie [{ root, id, intervals, roman, symbol }].
 */
export function scaleChords(root, pattern) {
  if (!pattern) return []
  if (pattern.id === 'blues')
    return [0, 5, 7].map((i, k) => ({ root: (root + i) % 12, id: '7', intervals: [0, 4, 7, 10], roman: `${['I', 'IV', 'V'][k]}7`, symbol: '7' }))
  const scale = PARENT[pattern.id] ?? pattern.intervals
  if (scale.length !== 7) return []
  return scale.flatMap((interval, i) => {
    const third = (scale[(i + 2) % 7] - interval + 12) % 12
    const fifth = (scale[(i + 4) % 7] - interval + 12) % 12
    const id = TRIADS[`${third},${fifth}`]
    if (!id) return []
    const minor = id === 'min' || id === 'dim'
    const roman = (minor ? ROMAN[i].toLowerCase() : ROMAN[i]) + (id === 'dim' ? '°' : id === 'aug' ? '+' : '')
    const symbol = { maj: '', min: 'm', dim: '°', aug: '+' }[id]
    return [{ root: (root + interval) % 12, id, intervals: [0, third, fifth], roman, symbol }]
  })
}
