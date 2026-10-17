/**
 * Jam ping-pong : deux guitares (entrées 1 et 2 de l'interface) se renvoient la parole, phrase après phrase.
 * Variante « duel » (scores, vainqueur) ou « libre » (sans fin, juste le relais et les annonces).
 * Tout repose sur la hauteur des notes jouées, jamais sur la corde / case exactes.
 */

export const PLAYER_COLORS = ['var(--color-copper-400)', '#38bdf8']
export const PLAYER_NAMES = ['Joueur 1', 'Joueur 2']

export const VARIANTS = [
  { id: 'duel', name: 'Duel' },
  { id: 'libre', name: 'Jam libre' },
]
export const RELAYS = [
  { id: '16', name: '16 s', ms: 16000 },
  { id: '32', name: '32 s', ms: 32000 },
  { id: '48', name: '48 s', ms: 48000 },
  { id: 'phrase', name: 'Fin de phrase' },
]
export const TURN_COUNTS = [4, 8] // tours par joueur, en duel

const PHRASE_SILENCE_MS = 1500 // silence qui termine une phrase (relais « fin de phrase »)
const PHRASE_MIN_NOTES = 3 // une phrase compte au moins ça avant de pouvoir passer la main
const PHRASE_MAX_MS = 48000 // tour le plus long possible en « fin de phrase » (comme le relais le plus long)
const IDLE_MS = 8000 // sans aucune note, le tour passe
const GRACE_MS = 600 // les dernières notes du joueur précédent ne sont pas des interruptions
const RELANCE_MS = 1000 // première note jouée aussi vite après avoir reçu la main
const ECHO_LENGTH = 3 // notes reprises dans l'ordre pour un écho

const POINTS = { note: 10, resolution: 50, echo: 75, relance: 30, clean: 40, interrupt: -25 }

const newPlayer = () => ({ score: 0, notes: 0, hits: 0, echoes: 0, resolutions: 0, relances: 0, cleans: 0, interruptions: 0, turns: 0 })

export function createJam({ variant, relay, turns }, now) {
  return {
    variant,
    relay,
    turnsPerPlayer: turns,
    turn: 0, // joueur qui a la parole
    turnIndex: 0, // nombre de tours joués
    turnStartedAt: now,
    lastNoteAt: 0,
    phrase: [], // notes du tour en cours : [{ pc, inScale, isRoot }]
    previousPhrase: [], // classes de hauteur de la phrase précédente (celle de l'adversaire)
    interrupted: false, // l'autre joueur a déjà coupé la parole pendant ce tour
    players: [newPlayer(), newPlayer()],
    over: false,
  }
}

const relayMs = (jam) => RELAYS.find((r) => r.id === jam.relay)?.ms ?? null

/**
 * Note jouée par `player` : { pc, inScale, isRoot }. Renvoie les événements à annoncer.
 * points : valeur d'une note juste (calculée par le combo du joueur, multiplicateur compris).
 */
export function jamNote(jam, player, note, now, points = POINTS.note) {
  if (jam.over) return []
  if (player !== jam.turn) {
    // Fin de phrase du joueur précédent qui déborde sur le relais : tolérée
    if (now - jam.turnStartedAt < GRACE_MS && jam.turnIndex > 0) return []
    if (jam.variant !== 'duel' || jam.interrupted) return []
    jam.interrupted = true
    const p = jam.players[player]
    p.interruptions++
    p.score += POINTS.interrupt
    return [{ type: 'interrupt', player, points: POINTS.interrupt }]
  }

  const p = jam.players[player]
  const events = []
  if (!jam.phrase.length && jam.turnIndex > 0 && now - jam.turnStartedAt < RELANCE_MS) {
    p.relances++
    p.score += POINTS.relance
    events.push({ type: 'relance', player, points: POINTS.relance })
  }
  p.notes++
  if (note.inScale) {
    p.hits++
    p.score += points
    events.push({ type: 'hit', player, points })
  } else events.push({ type: 'miss', player })
  jam.phrase.push(note)
  jam.lastNoteAt = now
  return events
}

/** Deux phrases partagent-elles au moins ECHO_LENGTH notes consécutives, dans le même ordre ? */
function hasEcho(phrase, previous) {
  if (phrase.length < ECHO_LENGTH || previous.length < ECHO_LENGTH) return false
  const key = (arr, i) => arr.slice(i, i + ECHO_LENGTH).join(',')
  const seen = new Set()
  for (let i = 0; i + ECHO_LENGTH <= previous.length; i++) seen.add(key(previous, i))
  for (let i = 0; i + ECHO_LENGTH <= phrase.length; i++) if (seen.has(key(phrase, i))) return true
  return false
}

function endTurn(jam, now, reason) {
  const player = jam.turn
  const p = jam.players[player]
  const phrase = jam.phrase
  const pcs = phrase.map((n) => n.pc)
  const events = [{ type: 'turn-end', player, reason, notes: phrase.length }]

  if (phrase.length) {
    if (phrase.at(-1).isRoot) {
      p.resolutions++
      p.score += POINTS.resolution
      events.push({ type: 'resolution', player, points: POINTS.resolution })
    }
    if (hasEcho(pcs, jam.previousPhrase)) {
      p.echoes++
      p.score += POINTS.echo
      events.push({ type: 'echo', player, points: POINTS.echo })
    }
    if (phrase.length >= 4 && phrase.every((n) => n.inScale)) {
      p.cleans++
      p.score += POINTS.clean
      events.push({ type: 'clean', player, points: POINTS.clean })
    }
  }

  p.turns++
  if (phrase.length) jam.previousPhrase = pcs
  jam.phrase = []
  jam.turnIndex++
  if (jam.variant === 'duel' && jam.turnIndex >= jam.turnsPerPlayer * 2) {
    jam.over = true
    events.push({ type: 'over' })
    return events
  }
  jam.turn = 1 - player
  jam.turnStartedAt = now
  jam.lastNoteAt = 0
  jam.interrupted = false
  events.push({ type: 'turn', player: jam.turn })
  return events
}

/** À appeler régulièrement : passe la main quand le tour est fini. */
export function jamTick(jam, now) {
  if (jam.over) return []
  const age = now - jam.turnStartedAt
  const fixed = relayMs(jam)
  if (fixed) return age >= fixed ? endTurn(jam, now, 'time') : []
  if (!jam.phrase.length) return age >= IDLE_MS ? endTurn(jam, now, 'idle') : []
  if (jam.phrase.length >= PHRASE_MIN_NOTES && now - jam.lastNoteAt >= PHRASE_SILENCE_MS) return endTurn(jam, now, 'phrase')
  return age >= PHRASE_MAX_MS ? endTurn(jam, now, 'time') : []
}

/** Temps restant du tour, de 1 à 0 (en « fin de phrase » : le silence qui va clore la phrase). */
export function turnLeft(jam, now) {
  const fixed = relayMs(jam)
  if (fixed) return Math.max(0, 1 - (now - jam.turnStartedAt) / fixed)
  if (!jam.phrase.length) return Math.max(0, 1 - (now - jam.turnStartedAt) / IDLE_MS)
  if (jam.phrase.length < PHRASE_MIN_NOTES) return 1
  return Math.max(0, 1 - (now - jam.lastNoteAt) / PHRASE_SILENCE_MS)
}

/** Passe la main tout de suite (bouton « Passer »). */
export const passTurn = (jam, now) => (jam.over ? [] : endTurn(jam, now, 'pass'))

/** Bilan : vainqueur (0, 1, ou null en cas d'égalité / jam libre) et statistiques par joueur. */
export function jamResult(jam) {
  const players = jam.players.map((p, i) => ({
    ...p,
    name: PLAYER_NAMES[i],
    accuracy: p.notes ? Math.round((p.hits / p.notes) * 100) : 0,
  }))
  const [a, b] = players
  const winner = jam.variant !== 'duel' || a.score === b.score ? null : a.score > b.score ? 0 : 1
  return { players, winner, turns: jam.turnIndex, variant: jam.variant }
}
