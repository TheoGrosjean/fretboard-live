/**
 * Moteur de combo « à la Guitar Hero » pour l'improvisation sur une gamme.
 * Logique pure (sans Vue ni minuteur) : chaque appel renvoie la liste des événements à afficher.
 *
 * Règles :
 *  - +1 au combo par note dans la gamme ; multiplicateur ×1 → ×4 par paliers
 *  - droit à l'erreur : une fausse note isolée est pardonnée, deux d'affilée cassent le combo
 *  - anti-répétition : au-delà de 8 fois la même note d'affilée, le combo ne monte plus
 *  - bonus d'exploration (nouvelle position sur le manche), de gamme complète et de résolution
 *    (phrase terminée sur la tonique suivie d'un silence)
 *  - le combo se perd après quelques secondes sans jouer
 *  - fin de phrase (silence après au moins 3 notes) : événement avec le degré de la dernière note,
 *    pour annoncer la sensation qu'elle produit (voir lib/feelings.js)
 *  - slides / bends / legato : une note hors gamme jouée sans attaque, à 1–2 demi-tons de la précédente,
 *    est une note de passage — ni erreur, ni comptée dans la précision
 *  - grand slide (au moins 5 cases d'un coup, sans attaque) : bonus et annonce « SLIDE » ; s'il arrive
 *    hors gamme, c'est une note de passage
 */

export const TIERS = [0, 10, 25, 50] // combo nécessaire pour ×1, ×2, ×3, ×4
export const MILESTONES = [10, 25, 50, 100, 150, 200, 300, 500]
export const DECAY_MS = 5000 // silence avant la perte du combo
export const PHRASE_GAP_MS = 1200 // silence qui marque la fin d'une phrase
export const MAX_REPEATS = 8 // au-delà, la même note répétée ne fait plus monter le combo
export const ALLOWED_MISSES = 1 // fausses notes d'affilée tolérées
export const MIN_PHRASE_NOTES = 3 // notes minimum pour annoncer la sensation de fin de phrase
export const GLIDE_SEMITONES = 2 // écart maximal d'une note de passage avec la note précédente
export const SLIDE_MIN_SEMITONES = 5 // écart minimal d'un grand slide
const SLIDE_COVERAGE = 0.4 // part des demi-tons intermédiaires qu'on doit avoir entendus pendant le glissé

const POINTS = { note: 10, explore: 5, fullScale: 100, resolution: 50, slide: 20 }

/**
 * Grand slide : arrivée sans attaque à au moins SLIDE_MIN_SEMITONES, en passant par une bonne partie
 * des demi-tons intermédiaires (`swept`). Écarte les erreurs d'octave et les hammer-ons, qui sautent d'un coup.
 */
export function isSlide(from, to, swept) {
  const span = Math.abs(to - from)
  if (span < SLIDE_MIN_SEMITONES) return false
  let heard = 0
  for (let m = Math.min(from, to) + 1; m < Math.max(from, to); m++) if (swept.has(m)) heard++
  return heard >= (span - 1) * SLIDE_COVERAGE
}

export const multiplierFor = (combo) => TIERS.filter((t) => combo >= t).length

/** Progression 0–1 vers le palier suivant (1 au dernier palier). */
export function tierProgress(combo) {
  const m = multiplierFor(combo)
  if (m >= TIERS.length) return 1
  const from = TIERS[m - 1]
  return (combo - from) / (TIERS[m] - from)
}

export function createRun() {
  return {
    combo: 0,
    score: 0,
    bestCombo: 0,
    notes: 0, // notes jouées
    hits: 0, // notes dans la gamme
    misses: 0, // fausses notes d'affilée
    lastMidi: null,
    prevMidi: null, // dernière note entendue, même de passage (pour enchaîner un slide)
    repeats: 0,
    lastAt: 0,
    lastWasRoot: false,
    phraseLength: 0,
    phraseNotes: 0, // notes de la phrase en cours, même hors gamme
    lastInterval: null, // degré (0–11 depuis la tonique) de la dernière note
    positions: new Set(), // positions déjà jouées (exploration)
    degrees: new Set(), // degrés joués pendant le combo en cours
    fullScale: false,
  }
}

function breakCombo(run, reason) {
  const events = run.combo >= 3 ? [{ type: 'break', combo: run.combo, reason }] : []
  run.combo = 0
  run.misses = 0
  run.repeats = 0
  run.degrees.clear()
  run.fullScale = false
  return events
}

/**
 * Une note jouée.
 * note : { midi, string, fret, info, legato, interval, slide } — info = degré dans la gamme, ou null si hors gamme ;
 *        legato = la note est arrivée sans nouvelle attaque (slide, bend, hammer-on…) ;
 *        slide = { from, to } (midi) si la note termine un grand slide ;
 *        interval = écart avec la tonique (0–11), même hors gamme
 * scaleSize : nombre de notes de la gamme (pour « gamme complète »)
 */
export function playNote(run, { midi, string, fret, info, legato = false, interval = null, slide = null }, scaleSize, now) {
  const prevMidi = run.prevMidi
  run.prevMidi = midi
  run.lastAt = now
  const slideEvent = slide && { type: 'slide', span: Math.abs(slide.to - slide.from), up: slide.to > slide.from }

  if (!info && legato && prevMidi !== null && (slide || Math.abs(midi - prevMidi) <= GLIDE_SEMITONES)) {
    return slideEvent ? [{ type: 'glide' }, slideEvent] : [{ type: 'glide' }]
  }

  run.notes++
  run.phraseNotes++
  run.lastInterval = interval ?? info?.interval ?? null

  if (!info) {
    run.misses++
    run.lastMidi = midi
    run.repeats = 0
    run.lastWasRoot = false
    if (run.misses > ALLOWED_MISSES) return [{ type: 'miss' }, ...breakCombo(run, 'misses')]
    return [{ type: 'miss' }, { type: 'warning' }]
  }

  run.hits++
  run.misses = 0
  run.repeats = midi === run.lastMidi ? run.repeats + 1 : 1
  run.lastMidi = midi
  run.lastWasRoot = info.isRoot
  run.phraseLength++
  if (run.repeats > MAX_REPEATS) return [{ type: 'repeat' }]

  const before = multiplierFor(run.combo)
  run.combo++
  run.bestCombo = Math.max(run.bestCombo, run.combo)
  const mult = multiplierFor(run.combo)
  const events = []

  let points = POINTS.note
  const position = `${string}-${fret}`
  const explored = !run.positions.has(position)
  if (explored) {
    run.positions.add(position)
    points += POINTS.explore
  }

  run.degrees.add(info.interval)
  if (!run.fullScale && scaleSize > 0 && run.degrees.size >= scaleSize) {
    run.fullScale = true
    points += POINTS.fullScale
    events.push({ type: 'full-scale' })
  }

  if (slideEvent) {
    points += POINTS.slide
    events.push(slideEvent)
  }

  run.score += points * mult
  events.unshift({ type: 'hit', points: points * mult, explored })
  if (mult > before) events.push({ type: 'tier', mult })
  if (MILESTONES.includes(run.combo)) events.push({ type: 'milestone', combo: run.combo })
  return events
}

/** À appeler régulièrement : fin de phrase (bonus de résolution, sensation) et perte du combo après un silence. */
export function checkSilence(run, now) {
  if (!run.lastAt) return []
  const gap = now - run.lastAt
  const events = []

  if (gap >= PHRASE_GAP_MS && run.phraseLength > 0) {
    // Phrase d'au moins 4 notes terminée sur la tonique
    if (run.lastWasRoot && run.phraseLength >= 4 && run.combo > 0) {
      const points = POINTS.resolution * multiplierFor(run.combo)
      run.score += points
      events.push({ type: 'resolution', points })
    }
    run.phraseLength = 0
    run.lastWasRoot = false
  }
  if (gap >= PHRASE_GAP_MS && run.phraseNotes > 0) {
    if (run.phraseNotes >= MIN_PHRASE_NOTES && run.lastInterval !== null) events.push({ type: 'phrase-end', interval: run.lastInterval })
    run.phraseNotes = 0
    run.lastInterval = null
  }

  if (run.combo > 0 && gap >= DECAY_MS) events.push(...breakCombo(run, 'timeout'))
  return events
}
