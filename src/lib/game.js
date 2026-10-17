/**
 * Mode jeu (plein écran) : modes de partie, cibles du mode « Cible », rangs et records.
 * Tout repose sur la note jouée (hauteur), jamais sur la corde / case exactes, peu fiables à la détection.
 */
import { createTrackSession, rankFor } from './finisher.js'
import { feelingFor } from './feelings.js'

export const MODES = [
  { id: 'libre', name: 'Libre', desc: 'Partie sans fin : enchaîne les combos, arrête quand tu veux.' },
  { id: 'chrono', name: 'Contre la montre', desc: 'Le meilleur score possible avant la fin du chrono.' },
  { id: 'morceau', name: 'Morceau', desc: 'Joue sur la backing track Spotify, du début à la fin.' },
  { id: 'cible', name: 'Cible', desc: 'Le jeu annonce un degré : trouve-le vite, n’importe où sur le manche.' },
]
export const CHRONO_DURATIONS = [60, 120] // s

export const COUNTDOWN_STEPS = ['3', '2', '1', 'GO !']
export const COUNTDOWN_STEP_MS = 700

// Mode Cible
export const TARGET_MS = 5000 // temps pour trouver la note
const TARGET_POINTS = 50 // + jusqu'à 50 de bonus de vitesse, × le multiplicateur de série

/** Noms des degrés, tels qu'annoncés en grand. */
const DEGREE_NAMES = {
  1: 'Tonique',
  b2: 'Seconde mineure',
  2: 'Seconde',
  b3: 'Tierce mineure',
  3: 'Tierce majeure',
  4: 'Quarte',
  '#4': 'Quarte augmentée',
  b5: 'Quinte diminuée',
  5: 'Quinte',
  '#5': 'Quinte augmentée',
  b6: 'Sixte mineure',
  6: 'Sixte',
  bb7: 'Septième diminuée',
  b7: 'Septième mineure',
  7: 'Septième majeure',
}
export const degreeName = (degree) => DEGREE_NAMES[degree] ?? `Degré ${degree}`

/** Nouvelle cible, différente de la précédente : { pc, degree, startedAt }. */
export function pickTarget(overlay, previous, now) {
  const choices = [...overlay.entries()].filter(([pc]) => pc !== previous?.pc)
  const [pc, info] = choices[Math.floor(Math.random() * choices.length)] ?? [...overlay.entries()][0]
  return { pc, degree: info.degree, startedAt: now }
}

export const targetMultiplier = (streak) => (streak >= 12 ? 4 : streak >= 8 ? 3 : streak >= 4 ? 2 : 1)

/** Points d'une cible trouvée après `elapsed` ms, avec la série en cours (avant ce coup). */
export function targetPoints(elapsed, streak) {
  const speed = Math.max(0, 1 - elapsed / TARGET_MS)
  return Math.round((TARGET_POINTS + 50 * speed) * targetMultiplier(streak))
}

/** Statistiques d'une partie : mêmes compteurs que pour un morceau, plus ceux du mode Cible. */
export function createGameSession() {
  return { ...createTrackSession(null), targets: 0, targetHits: 0, streak: 0, bestStreak: 0 }
}

/** Rang du mode Cible (précision sur les cibles et meilleure série). */
function targetRank(accuracy, bestStreak) {
  if (accuracy >= 90 && bestStreak >= 15) return 'S'
  if (accuracy >= 80 && bestStreak >= 8) return 'A'
  if (accuracy >= 60) return 'B'
  return 'C'
}

const WORDS = { S: 'PERFECT!', A: 'EXCELLENT!', B: 'FINISH!', C: 'FINISH!' }

/** Résultat pour l'écran de fin (même forme que sessionResult() de lib/finisher.js). */
export function gameResult(session, { mode, title, subtitle, record }) {
  const cible = mode === 'cible'
  const accuracy = cible
    ? session.targets ? Math.round((session.targetHits / session.targets) * 100) : 0
    : session.notes ? Math.round((session.hits / session.notes) * 100) : 0
  const bestCombo = cible ? session.bestStreak : session.bestCombo
  const rank = cible ? targetRank(accuracy, bestCombo) : rankFor(accuracy, bestCombo)
  const favourite = Object.entries(session.feelings).sort((a, b) => b[1] - a[1])[0]
  return {
    rank,
    word: WORDS[rank],
    title,
    artist: subtitle,
    score: session.score,
    bestCombo,
    accuracy,
    newRecord: session.score > 0 && session.score > record,
    style: favourite ? feelingFor(Number(favourite[0])).word : '—', // sensation de fin de phrase la plus jouée
    count: cible ? `${session.targetHits}/${session.targets}` : String(session.notes),
  }
}

// ---------- Records (meilleur score par mode, durée et gamme) ----------
const RECORDS_KEY = 'fb.gameRecords'

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) ?? {}
  } catch {
    return {}
  }
}

export const recordKey = (mode, duration, scaleKey) => `${mode}${mode === 'chrono' ? duration : ''}:${scaleKey}`
export const getRecord = (key) => loadRecords()[key] ?? 0

export function saveRecord(key, score) {
  const records = loadRecords()
  if (score <= (records[key] ?? 0)) return false
  localStorage.setItem(RECORDS_KEY, JSON.stringify({ ...records, [key]: score }))
  return true
}
