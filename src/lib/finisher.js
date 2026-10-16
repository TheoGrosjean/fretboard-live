/**
 * Bilan d'un backing track pour l'écran « FINISH! » : statistiques accumulées pendant le morceau
 * (indépendantes des remises à zéro du combo), puis rang et mot d'impact.
 */
import { feelingFor } from './feelings.js'

export const MIN_NOTES = 15 // en dessous, pas de finisher (tu n'as pas vraiment joué sur ce morceau)

export function createTrackSession(track) {
  return { track, notes: 0, hits: 0, score: 0, bestCombo: 0, resolutions: 0, feelings: {} }
}

/** Prend en compte un événement du moteur de combo (voir lib/combo.js). */
export function recordEvent(session, e) {
  if (e.type === 'hit') {
    session.notes++
    session.hits++
    session.score += e.points
  } else if (e.type === 'repeat') {
    session.notes++
    session.hits++
  } else if (e.type === 'miss') session.notes++
  else if (e.type === 'resolution') {
    session.resolutions++
    session.score += e.points
  } else if (e.type === 'phrase-end') session.feelings[e.interval] = (session.feelings[e.interval] ?? 0) + 1
}

export function rankFor(accuracy, bestCombo) {
  if (accuracy >= 92 && bestCombo >= 50) return 'S'
  if (accuracy >= 85 && bestCombo >= 25) return 'A'
  if (accuracy >= 70) return 'B'
  return 'C'
}

const WORDS = { S: 'PERFECT!', A: 'EXCELLENT!', B: 'FINISH!', C: 'FINISH!' }

/** Résultat affiché par le finisher, ou null si le morceau n'a pas été assez joué. */
export function sessionResult(session, previousRecord = 0) {
  if (!session || session.notes < MIN_NOTES) return null
  const accuracy = Math.round((session.hits / session.notes) * 100)
  const rank = rankFor(accuracy, session.bestCombo)
  const favourite = Object.entries(session.feelings).sort((a, b) => b[1] - a[1])[0]
  return {
    rank,
    word: WORDS[rank],
    title: session.track.name,
    artist: session.track.artists,
    score: session.score,
    bestCombo: session.bestCombo,
    accuracy,
    newRecord: session.score > previousRecord,
    style: favourite ? feelingFor(Number(favourite[0])).word : '—',
  }
}
