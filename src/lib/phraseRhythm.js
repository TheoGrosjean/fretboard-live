/**
 * Rythme des phrasés : calage sur la grille, quantification « intelligente », et prise libre
 * (retrouver le tempo et la grille d'un phrasé joué sans métronome).
 *
 * Toutes les positions sont en temps (1 = une noire). Les écarts sont jugés en millisecondes au tempo
 * de l'enregistrement : 20 ms d'avance, c'est peu à 60 BPM comme à 180 BPM.
 */
import { GRID_MIX, gridStep, snapBeat } from './phrases'

// ---------- Quantification par temps : la grille la plus simple qui explique les notes ----------
// Chaque temps reçoit une grille : noires, croches, doubles croches (binaire) ou triolets (ternaire).
// Coût d'une grille pour un temps : l'écart des notes à leurs cases (en ms, rapporté au flottement normal
// d'un guitariste) + un prix pour sa finesse (une grille plus fine explique toujours mieux, il faut
// qu'elle le mérite). Et passer du binaire au ternaire d'un temps à l'autre coûte cher : sinon, quelques
// « triolets » absorberaient le flottement naturel du jeu. Le meilleur étiquetage des temps est trouvé
// d'un coup, par programmation dynamique (Viterbi), comme le doigté.

const SIGMA_MS = 32 // flottement rythmique « normal » d'une note jouée (adapté à la prise libre, voir inferRhythm)
const CANDIDATES = [
  { g: 1, price: 0, ternary: false },
  { g: 2, price: 1, ternary: false },
  { g: 4, price: 2, ternary: false },
  // Triolets : plus chers que les doubles croches. Un flux régulier de notes est ambigu (4 notes par temps
  // à 90 BPM = 3 notes par temps à 120 BPM) et, sans autre indice, il est plus souvent binaire
  { g: 3, price: 2.5, ternary: true },
]
const SWITCH_PRICE = 1.2 // passage binaire <-> ternaire entre deux temps (un triolet dans un lick en croches reste courant)
const EMPTY_BEAT_PRICE = 0.4 // temps sans note au milieu du phrasé (des blanches à 144 BPM : plutôt des noires à 72)

/** Regroupe les instants par temps ; une note juste avant un temps (dernier huitième) appartient à ce temps. */
function byBeat(xs) {
  const groups = new Map()
  xs.forEach((x, i) => {
    const k = Math.floor(x + 1 / 8)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  })
  return [...groups].sort((a, b) => a[0] - b[0])
}

/** Coût d'une grille pour les notes idx du temps k : { cost, snapped } ou null si elle ne convient pas. */
function fitBeat(xs, idx, k, msPerBeat, { g, price }, sigma) {
  let cost = price
  const seen = new Set()
  const snapped = []
  for (const i of idx) {
    const s = Math.round((xs[i] - k) * g) / g
    if (s >= 1 - 1e-9) return null // la case tombe sur le temps suivant : cette grille ne convient pas à ce temps
    const err = ((xs[i] - k - s) * msPerBeat) / sigma
    cost += err * err
    const slot = Math.round(s * 12)
    if (seen.has(slot)) cost += 25 // deux notes sur la même case : à éviter (le jeu est monophonique)
    seen.add(slot)
    snapped.push(k + s)
  }
  return { cost, snapped }
}

/**
 * Meilleur étiquetage des temps (Viterbi). Renvoie { cost, beats (temps occupés), snapped (positions
 * calées, non bornées à 0), ternary (part des temps en triolets) }.
 */
function labelBeats(xs, msPerBeat, sigma = SIGMA_MS) {
  const groups = byBeat(xs)
  const snapped = new Array(xs.length)
  if (!groups.length) return { cost: 0, beats: 0, snapped, ternary: 0 }
  const fits = groups.map(([k, idx]) => CANDIDATES.map((c) => fitBeat(xs, idx, k, msPerBeat, c, sigma)))
  let cost = fits[0].map((f) => (f ? f.cost : Infinity))
  const from = []
  for (let j = 1; j < groups.length; j++) {
    const back = []
    cost = CANDIDATES.map((c, s) => {
      if (!fits[j][s]) return back.push(0), Infinity
      let best = Infinity
      let arg = 0
      CANDIDATES.forEach((p, r) => {
        const v = cost[r] + (p.ternary === c.ternary ? 0 : SWITCH_PRICE)
        if (v < best) [best, arg] = [v, r]
      })
      back.push(arg)
      return best + fits[j][s].cost
    })
    from.push(back)
  }
  let s = cost.indexOf(Math.min(...cost))
  const span = groups.at(-1)[0] - groups[0][0] + 1
  const total = cost[s] + (span - groups.length) * EMPTY_BEAT_PRICE
  let ternary = 0
  for (let j = groups.length - 1; j >= 0; j--) {
    groups[j][1].forEach((i, m) => (snapped[i] = fits[j][s].snapped[m]))
    if (CANDIDATES[s].ternary) ternary++
    if (j > 0) s = from[j - 1][s]
  }
  return { cost: total, beats: groups.length, snapped, ternary: ternary / groups.length }
}

/**
 * Quantification mixte : chaque temps reçoit sa propre grille (croches ici, triolets là…).
 * xs : instants joués (en temps), bpm : tempo de la prise. Renvoie les positions calées (non bornées à 0).
 */
export const smartQuantize = (xs, bpm, sigma) => labelBeats(xs, 60000 / bpm, sigma).snapped

const place = (xs, grid, bpm) => (grid === GRID_MIX ? smartQuantize(xs, bpm).map((x) => Math.max(0, x)) : xs.map((x) => snapBeat(x, grid)))

// ---------- Calage automatique ----------

/**
 * Cherche le décalage constant qui rapproche le plus les notes jouées de la grille (ton jeu un peu en avance
 * ou en retard sur tout l'enregistrement), puis replace chaque note. Part des instants réellement joués (raw)
 * quand on les a, sinon des notes déjà calées. Renvoie { notes, offset } ; offset en temps (> 0 : en retard).
 */
export function autoAlign(notes, grid, bpm = 100) {
  const raw = notes.map((n) => n.raw ?? n.beat)
  // En grille mixte, le décalage se mesure sur les doubles croches (la grille fine la plus courante)
  const base = grid === GRID_MIX ? 4 : grid
  const step = 1 / base
  const dist = (x) => Math.abs(x - Math.round(x / step) * step)
  let best = { offset: 0, cost: Infinity }
  for (let i = -25; i <= 25; i++) {
    const offset = (i / 50) * step
    // Léger avantage au décalage nul : à coût égal, on ne bouge rien
    const cost = raw.reduce((sum, r) => sum + dist(r - offset), 0) + Math.abs(offset) * 0.05
    if (cost < best.cost) best = { offset, cost }
  }
  // Un décalage n'est connu qu'à une case près (150 ms de retard ou 100 ms d'avance sur la case suivante
  // collent aussi bien à la grille) : on préfère celui qui pose la première note sur un temps, idéalement
  // le premier, puis le plus petit décalage
  const first = Math.min(...raw)
  const score = (offset) => {
    const start = snapBeat(first - offset, base)
    return Math.abs(offset) + (Number.isInteger(start) ? 0 : step / 2) + (start === 0 ? 0 : step / 5)
  }
  const offset = [best.offset - step, best.offset, best.offset + step].reduce((a, b) => (score(b) < score(a) ? b : a))
  const beats = place(
    raw.map((r) => r - offset),
    grid,
    bpm,
  )
  return { notes: notes.map((n, i) => ({ ...n, beat: beats[i] })), offset }
}

/** Replace les notes sur une autre grille (ex. croches -> doubles croches), à partir des instants joués. */
export function requantize(notes, grid, bpm = 100) {
  const beats = place(
    notes.map((n) => n.raw ?? n.beat),
    grid,
    bpm,
  )
  return notes.map((n, i) => ({ ...n, beat: beats[i], dur: n.dur !== undefined ? Math.max(gridStep(grid), snapBeat(n.dur, grid === GRID_MIX ? 4 : grid)) : undefined }))
}

/** Décale tout le phrasé d'un nombre de temps (refusé si une note passerait avant le début). */
export function shiftAll(notes, by) {
  if (notes.some((n) => n.beat + by < -1e-6)) return null
  return notes.map((n) => ({ ...n, beat: Math.max(0, n.beat + by), raw: n.raw !== undefined ? n.raw + by : undefined }))
}

/** La grille la plus simple qui contient toutes les positions (pour nommer la grille d'une prise libre). */
export function simplestGrid(beats) {
  for (const g of [1, 2, 4, 3]) if (beats.every((b) => Math.abs(b * g - Math.round(b * g)) < 1e-6)) return g
  return GRID_MIX
}

// ---------- Prise libre : retrouver le tempo d'un phrasé joué sans métronome ----------
// 1. Sur le début de la prise (12 notes : sans clic, le tempo dérive, et un tempo constant expliquerait mal
//    la fin), tous les tempos de 50 à 220 BPM et 48 phases par temps sont essayés : on garde celui dont la
//    quantification mixte coûte le moins, avec un a priori doux autour de 100 BPM. Sans lui, un phrasé en
//    croches à 100 BPM serait aussi bien expliqué en noires à 200 BPM (l'ambiguïté du double tempo).
// 2. Affinage au dixième de BPM des meilleurs candidats.
// 3. Suivi du tempo sur toute la prise : la correspondance instant = a + b × temps est réajustée sur les
//    8 dernières notes (régression), comme un batteur qui suit le guitariste.
// 4. Les autres lectures plausibles (×2, ÷2, binaire / ternaire…) sont proposées : seul le guitariste sait
//    si son phrasé est en croches à 120 ou en triolets à 80.

// A priori de tempo, compté par note : il reste neutre entre « croches à 140 » et « doubles à 70 »
// (même nombre de notes), et départage par la distance à un tempo courant
const PRIOR_WEIGHT = 0.4
const PRIOR_CENTER = 100
const PRIOR_WIDTH = 0.6 // en octaves de tempo
const HEAD_NOTES = 12
const MIN_BPM = 50
const MAX_BPM = 220

const tempoPrior = (bpm, notes) => PRIOR_WEIGHT * notes * (Math.log2(bpm / PRIOR_CENTER) / PRIOR_WIDTH) ** 2
const clampBpm = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))

function searchTempo(times, bpms, phases, { perBpm = null, sigma = SIGMA_MS } = {}) {
  let best = null
  for (const bpm of bpms) {
    let local = null
    const P = 60 / bpm
    const msPerBeat = P * 1000
    for (let s = 0; s < phases; s++) {
      const phi = (s / phases) * P
      const { cost, snapped, ternary } = labelBeats(
        times.map((t) => (t - phi) / P),
        msPerBeat,
        sigma,
      )
      // Léger a priori : un phrasé commence plutôt sur un temps
      const total = cost + tempoPrior(bpm, times.length) + (Number.isInteger(Math.round(snapped[0] * 12) / 12) ? 0 : 1)
      if (!local || total < local.total) local = { bpm, phi, total, ternary }
    }
    perBpm?.push(local)
    if (!best || local.total < best.total) best = local
  }
  return best
}

/**
 * Tempo d'une prise : recherche grossière (au BPM, 48 phases), puis affinage des 6 meilleurs creux de la
 * courbe de coût — un échantillonnage grossier peut rater le bon tempo de peu et en préférer un voisin.
 */
function findTempo(times, sigma) {
  const curve = []
  searchTempo(times, range(MIN_BPM, MAX_BPM, 1), 48, { perBpm: curve, sigma })
  const minima = curve.filter((c, i) => (i === 0 || c.total <= curve[i - 1].total) && (i === curve.length - 1 || c.total <= curve[i + 1].total))
  const candidates = minima
    .sort((a, b) => a.total - b.total)
    .slice(0, 6)
    .map((c) => refine(times, c.bpm, sigma))
    .sort((a, b) => a.total - b.total)
  return { best: candidates[0], candidates }
}
const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step)
/** Meilleur tempo autour de `bpm` (±1 BPM, au dixième). */
const refine = (times, bpm, sigma) => searchTempo(times, range(Math.max(MIN_BPM, bpm - 1), Math.min(MAX_BPM, bpm + 1), 0.1), 96, { sigma })

// Cases sur lesquelles le suivi accroche les notes, selon le caractère trouvé (binaire, ternaire, mixte)
const POSITIONS = { binary: [0, 1 / 4, 1 / 2, 3 / 4, 1], ternary: [0, 1 / 3, 2 / 3, 1], mixed: [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1] }
const nearestPosition = (x, slots) => {
  const k = Math.floor(x)
  const f = x - k
  return k + slots.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a))
}

/** Régression t = a + b·q sur des couples [q, t]. */
function fitLine(pairs) {
  const n = pairs.length
  const mq = pairs.reduce((s, [q]) => s + q, 0) / n
  const mt = pairs.reduce((s, [, t]) => s + t, 0) / n
  let num = 0
  let den = 0
  for (const [q, t] of pairs) {
    num += (q - mq) * (t - mt)
    den += (q - mq) ** 2
  }
  if (den < 1e-9) return null
  const b = num / den
  return { a: mt - b * mq, b }
}

/** Écart moyen (ms) des notes à leurs cases, pour une lecture { bpm, phi } : le flottement de la prise. */
function residualMs(times, { bpm, phi }, sigma) {
  const P = 60 / bpm
  const xs = times.map((t) => (t - phi) / P)
  const { snapped } = labelBeats(xs, P * 1000, sigma)
  return Math.sqrt(xs.reduce((sum, x, i) => sum + ((x - snapped[i]) * P * 1000) ** 2, 0) / xs.length)
}

/** Suivi du tempo : instants -> positions en temps (non calées), en suivant la dérive. */
function track(times, { bpm, phi, ternary = 0 }) {
  const slots = ternary > 0.75 ? POSITIONS.ternary : ternary > 0.25 ? POSITIONS.mixed : POSITIONS.binary
  let a = phi
  let b = 60 / bpm
  const xs = []
  const pairs = []
  for (const t of times) {
    const x = (t - a) / b
    xs.push(x)
    pairs.push([nearestPosition(x, slots), t])
    const fit = pairs.length >= 4 ? fitLine(pairs.slice(-8)) : null
    // La dérive reste douce : au-delà de ±12 % du tempo de départ, c'est une erreur de suivi, pas du jeu
    if (fit && Math.abs(fit.b * bpm - 60) < 60 * 0.12) ({ a, b } = fit)
  }
  return { xs, pairs }
}

/** Nom de la subdivision dominante d'une lecture (pour présenter les autres lectures). */
function feel(beats) {
  const fr = beats.map((x) => x - Math.floor(x)).filter((f) => f > 1e-6)
  if (!fr.length) return 'noires'
  const thirds = fr.filter((f) => Math.abs(f * 3 - Math.round(f * 3)) < 1e-6 && Math.abs(f * 2 - Math.round(f * 2)) > 1e-6).length
  if (thirds > fr.length / 2) return 'triolets'
  return fr.some((f) => Math.abs(f * 2 - Math.round(f * 2)) > 1e-6) ? 'doubles croches' : 'croches'
}

/**
 * Rythme d'une prise libre. onsets : [{ t (s), dur? (s) }] dans l'ordre ; bpm : tempo imposé (une autre
 * lecture choisie), sinon retrouvé. Renvoie { bpm, beats, durs, grid, feel, confidence (0–1), errorMs,
 * alternatives: [{ bpm, feel }] }.
 */
export function inferRhythm(onsets, { bpm: fixed = null } = {}) {
  const times = onsets.map((o) => o.t - onsets[0].t)
  if (times.length < 3) {
    // Trop peu de notes pour juger : on suppose des croches au tempo de leur écart
    const gap = times.length === 2 ? times[1] : 0.3
    const bpm = fixed ?? Math.round(clampBpm(30 / gap))
    const beats = times.map((t) => snapBeat((t * bpm) / 60, 2))
    return { bpm, beats, durs: onsets.map((o) => (o.dur ? Math.max(0.5, snapBeat((o.dur * bpm) / 60, 2)) : undefined)), grid: 2, feel: 'croches', confidence: 0.3, errorMs: 0, alternatives: [] }
  }
  const head = times.slice(0, HEAD_NOTES)
  // Flottement de la prise : mesuré sur une première lecture ; un jeu plus libre que prévu relance la
  // recherche avec une tolérance à sa mesure (sinon les écarts pousseraient vers des lectures compliquées)
  const search = (sigma) => (fixed ? { best: searchTempo(head, [fixed], 96, { sigma }), candidates: [] } : findTempo(head, sigma))
  let sigma = SIGMA_MS
  let found = search(sigma)
  const spread = residualMs(head, found.best, sigma)
  if (spread > 0.8 * SIGMA_MS) {
    sigma = Math.min(55, spread * 1.35)
    found = search(sigma)
  }
  const best = found.best
  const { xs, pairs } = track(times, best)
  // Tempo moyen de la prise, de la première à la dernière note
  const [q0, t0] = pairs[0]
  const [q1, t1] = pairs.at(-1)
  const bpm = fixed ?? Math.round(clampBpm(q1 > q0 ? (60 * (q1 - q0)) / (t1 - t0) : best.bpm))

  let beats = smartQuantize(xs, bpm, sigma)
  const shift = Math.floor(Math.min(...beats))
  beats = beats.map((x) => Math.max(0, x - shift))
  const errorMs = (xs.reduce((sum, x, i) => sum + Math.abs(x - shift - beats[i]), 0) / xs.length) * (60000 / bpm)
  const grid = simplestGrid(beats)
  const durs = onsets.map((o) => (o.dur ? Math.max(gridStep(grid), snapBeat((o.dur * bpm) / 60, grid === GRID_MIX ? 4 : grid)) : undefined))

  // Autres lectures : les tempos liés (×2, ÷2, ×3/2…) et les autres creux de la recherche, quand ils
  // expliquent presque aussi bien la prise
  const alternatives = []
  if (!fixed) {
    const tried = [...found.candidates.slice(1)]
    for (const ratio of [1 / 2, 2 / 3, 3 / 4, 4 / 3, 3 / 2, 2]) {
      const alt = Math.round(best.bpm * ratio)
      if (alt >= MIN_BPM && alt <= MAX_BPM) tried.push(searchTempo(head, [alt], 96, { sigma }))
    }
    for (const other of tried.sort((x, y) => x.total - y.total)) {
      const alt = Math.round(other.bpm)
      const known = [bpm, ...alternatives.map((x) => x.bpm)].some((b) => Math.abs(b - alt) / b < 0.04)
      if (known || other.total > best.total * 1.8 + 6) continue
      alternatives.push({ bpm: alt, feel: feel(smartQuantize(track(times, other).xs, alt, sigma)), total: other.total })
    }
  }
  return {
    bpm,
    beats,
    durs,
    grid,
    feel: feel(beats),
    confidence: Math.max(0, Math.min(1, 1 - errorMs / 60)),
    errorMs: Math.round(errorMs),
    alternatives: alternatives.slice(0, 3).map(({ bpm: b, feel: f }) => ({ bpm: b, feel: f })),
  }
}
