/**
 * Entraînement des phrasés : ce que l'app attend, ce qu'elle a entendu, et ce qu'elle en conclut.
 *
 * - Pendant un passage, chaque note entendue est rapprochée tout de suite de l'attente la plus proche
 *   (retour immédiat à l'écran). À la fin du passage, tout est recalculé d'un coup par un alignement
 *   optimal (programmation dynamique) : la meilleure correspondance globale entre la suite attendue et la
 *   suite jouée, dans l'ordre — une note jouée deux fois, un écho ou une fausse note ne décalent plus rien.
 * - Chaque passage reçoit un bilan (notes, timing, régularité, techniques) et une note de S à D.
 * - Chaque note du phrasé garde ses statistiques (réussite, avance / retard moyens) : elles révèlent le
 *   point dur à travailler en boucle, et les transitions où tu presses ou retiens.
 * - Les méthodes de progression décident du tempo du passage suivant.
 * - Une révision espacée (à la SM-2) dit quand revenir sur un phrasé pour ne pas le perdre.
 */

/** Fenêtre de justesse rythmique, en ms, selon la tolérance choisie. */
export const TOLERANCES = [
  { id: 'easy', label: 'Très souple', ms: 200 },
  { id: 'loose', label: 'Souple', ms: 130 },
  { id: 'normal', label: 'Normale', ms: 90 },
  { id: 'strict', label: 'Stricte', ms: 55 },
]
export const toleranceOf = (id) => TOLERANCES.find((t) => t.id === id) ?? TOLERANCES[2]

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
export const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0
}
const clamp01 = (x) => Math.min(1, Math.max(0, x))

// ---------- Attentes d'un passage ----------

/**
 * Attentes d'un passage commençant au temps absolu `start` : les notes du phrasé (ou de la section
 * [from, to[ travaillée en boucle), transposées de `transpose` demi-tons.
 * state : null (pas encore jouée) | 'hit' | 'miss' ; offset : écart en ms (négatif = en avance).
 */
export function passTargets(notes, start, { from = 0, to = Infinity, transpose = 0 } = {}) {
  const out = []
  notes.forEach((n, index) => {
    if (n.beat < from - 1e-6 || n.beat >= to - 1e-6) return
    out.push({
      index,
      id: n.id,
      midi: n.midi + transpose,
      beat: start + n.beat - from,
      state: null,
      offset: 0,
      power: n.chord === 'power',
      pm: !!n.pm, // palm mute : le détecteur se trompe plus souvent d'octave sur ces notes courtes
      // Technique attendue (vérifiée à part) : 'legato' / 'slide' (la note arrive sans nouvelle attaque), 'bend'
      tech: n.bend ? 'bend' : n.tech === 'legato' || n.tech === 'slide' ? n.tech : null,
      bend: n.bend ?? 0,
      techState: null, // null | 'ok' | 'miss'
    })
  })
  return out
}

// Power chord : le détecteur entend la fondamentale ou la quinte, parfois à une autre octave
const isPowerNote = (root, midi) => [0, 7].includes((((midi - root) % 12) + 12) % 12)

/** Écart de hauteur toléré entre une attente et une note jouée : 0 (juste), un petit prix, ou null (autre note). */
function pitchCost(target, midi, octaveOk) {
  if (target.midi === midi) return 0
  if (target.power && isPowerNote(target.midi, midi)) return 0.1
  if (target.pm && target.midi % 12 === midi % 12) return 0.15 // note étouffée : l'octave est pardonnée
  if (octaveOk && target.midi % 12 === midi % 12) return 0.25 // erreur d'octave du détecteur, pas du guitariste
  return null
}

/**
 * Retour immédiat : l'attente libre la plus proche d'une note jouée (même hauteur, dans la fenêtre), ou null.
 */
export function matchNote(targets, midi, beat, windowBeats, { octaveOk = false } = {}) {
  let best = null
  let bestCost = Infinity
  for (const t of targets) {
    if (t.state) continue
    const pc = pitchCost(t, midi, octaveOk)
    const d = Math.abs(t.beat - beat)
    if (pc === null || d > windowBeats) continue
    const cost = d / windowBeats + pc
    if (cost < bestCost) [best, bestCost] = [t, cost]
  }
  return best
}

// ---------- Alignement optimal en fin de passage ----------

const MISS_COST = 1 // une attente sans note
const EXTRA_COST = 0.9 // une note jouée en trop
const ECHO_COST = 0.05 // la même note redétectée juste après : presque gratuit

/**
 * Meilleure correspondance, dans l'ordre, entre les attentes et les notes entendues pendant un passage
 * (Needleman-Wunsch : chaque attente est jouée ou ratée, chaque note entendue correspond à une attente ou
 * est en trop). Met à jour les attentes (state, offset, techState) et renvoie les hauteurs jouées en trop.
 * events : [{ midi, beat, legato, slide, bendMax, echo }] dans l'ordre.
 */
export function alignPass(targets, events, { windowBeats, beatMs, octaveOk = false, bendSlack = 0 }) {
  const T = targets.length
  const E = events.length
  const cols = E + 1
  const cost = new Float64Array((T + 1) * cols).fill(Infinity)
  const move = new Uint8Array((T + 1) * cols) // 1 : attente ratée, 2 : note en trop, 3 : correspondance
  cost[0] = 0
  const relax = (i, j, v, m) => {
    if (v < cost[i * cols + j]) {
      cost[i * cols + j] = v
      move[i * cols + j] = m
    }
  }
  for (let i = 0; i <= T; i++) {
    for (let j = 0; j <= E; j++) {
      const c = cost[i * cols + j]
      if (c === Infinity) continue
      if (i < T) relax(i + 1, j, c + MISS_COST, 1)
      if (j < E) relax(i, j + 1, c + (events[j].echo ? ECHO_COST : EXTRA_COST), 2)
      if (i < T && j < E) {
        const pc = pitchCost(targets[i], events[j].midi, octaveOk)
        const d = Math.abs(events[j].beat - targets[i].beat) / windowBeats
        if (pc !== null && d <= 1) relax(i + 1, j + 1, c + 0.6 * d * d + pc, 3)
      }
    }
  }
  // Remontée du meilleur chemin
  const matchOf = new Array(T).fill(-1)
  const extra = []
  for (let i = T, j = E; i > 0 || j > 0; ) {
    const m = move[i * cols + j]
    if (m === 3) matchOf[--i] = --j
    else if (m === 1) i--
    else extra.push(--j)
  }
  targets.forEach((t, i) => {
    const ev = events[matchOf[i]]
    if (!ev) {
      t.state = 'miss'
      t.techState = t.tech ? 'miss' : null
      return
    }
    t.state = 'hit'
    t.offset = Math.round((ev.beat - t.beat) * beatMs)
    // Lié / slide : la note doit arriver sans nouvelle attaque ; bend : l'amplitude atteinte
    if (t.tech === 'legato' || t.tech === 'slide') t.techState = ev.legato || ev.slide ? 'ok' : 'miss'
    else if (t.tech === 'bend') t.techState = ev.bendMax > 0 && Math.abs(ev.bendMax - t.bend) <= bendSlack ? 'ok' : 'miss'
  })
  return extra
    .filter((j) => !events[j].echo)
    .reverse()
    .map((j) => events[j].midi)
}

// ---------- Bilan d'un passage ----------

export const GRADES = {
  S: { label: 'S', hint: 'Impeccable' },
  A: { label: 'A', hint: 'Très propre' },
  B: { label: 'B', hint: 'Solide' },
  C: { label: 'C', hint: 'À consolider' },
  D: { label: 'D', hint: 'À reprendre plus lentement' },
}

/**
 * Bilan d'un passage terminé. wrongNotes : hauteurs jouées en trop. toleranceMs : la fenêtre (pour juger le
 * timing). Score sur 100 : notes justes (60 %), précision rythmique (30 %), techniques (10 %), moins les
 * fausses notes. spread : régularité (écart-type des avances / retards, en ms).
 */
export function scorePass(targets, wrongNotes, { toleranceMs, requireTech = false }) {
  const hits = targets.filter((t) => t.state === 'hit')
  const offsets = hits.map((t) => t.offset)
  const avg = mean(offsets)
  const spread = offsets.length > 1 ? Math.sqrt(mean(offsets.map((o) => (o - avg) ** 2))) : 0
  const techs = targets.filter((t) => t.tech && t.state === 'hit')
  const techOk = techs.filter((t) => t.techState === 'ok').length
  const clean = targets.length > 0 && hits.length === targets.length && wrongNotes.length === 0 && (!requireTech || techOk === techs.length)
  const noteScore = targets.length ? hits.length / targets.length : 0
  const timing = hits.length ? clamp01(1 - mean(offsets.map(Math.abs)) / toleranceMs) : 0
  const technique = techs.length ? techOk / techs.length : 1
  const score = Math.round(Math.max(0, Math.min(100, 100 * (0.6 * noteScore + 0.3 * timing + 0.1 * technique) - Math.min(30, wrongNotes.length * 6))))
  const grade = clean && score >= 92 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D'
  return {
    hits: hits.length,
    total: targets.length,
    missed: targets.filter((t) => t.state !== 'hit').map((t) => t.index), // notes ratées (rang dans le phrasé)
    wrong: wrongNotes.length,
    wrongNotes,
    techTotal: techs.length,
    techOk,
    techMissed: techs.filter((t) => t.techState !== 'ok').map((t) => t.index),
    clean,
    avgOffset: Math.round(avg), // ms : < 0 en avance, > 0 en retard
    spread: Math.round(spread),
    score,
    grade,
  }
}

// ---------- Statistiques par note ----------
// Moyennes glissantes (les derniers passages comptent plus que les premiers) : on suit ta progression,
// pas ta toute première tentative.

const RATE_SMOOTHING = 0.25

/** Met à jour les statistiques des notes d'un passage terminé (stats : objet indexé par id de note). */
export function updateNoteStats(stats, targets) {
  for (const t of targets) {
    if (!t.id) continue
    const s = (stats[t.id] ??= { tries: 0, hits: 0, rate: null, off: 0, abs: 0, techTries: 0, techOk: 0 })
    const hit = t.state === 'hit' ? 1 : 0
    s.tries++
    s.hits += hit
    s.rate = s.rate === null ? hit : s.rate + RATE_SMOOTHING * (hit - s.rate)
    if (hit) {
      const first = s.hits === 1
      s.off = first ? t.offset : s.off + RATE_SMOOTHING * (t.offset - s.off)
      s.abs = first ? Math.abs(t.offset) : s.abs + RATE_SMOOTHING * (Math.abs(t.offset) - s.abs)
      if (t.tech) {
        s.techTries++
        if (t.techState === 'ok') s.techOk++
      }
    }
  }
  return stats
}

const MIN_TRIES = 3 // en dessous, une statistique ne veut encore rien dire

/** Profil par note : { index, rate (0–1) | null, off (ms), tries } dans l'ordre du phrasé. */
export function noteProfile(notes, stats) {
  return notes.map((n, index) => {
    const s = stats?.[n.id]
    return s && s.tries >= MIN_TRIES ? { index, rate: s.rate, off: Math.round(s.off), abs: Math.round(s.abs), tries: s.tries } : { index, rate: null, off: 0, abs: 0, tries: s?.tries ?? 0 }
  })
}

/**
 * Point dur : la suite de 2 à 6 notes consécutives la plus difficile (réussite faible, timing flottant,
 * techniques ratées), si elle se détache vraiment du reste. Renvoie { start, end (indices inclus), rate,
 * from, to (section en temps entiers) } ou null.
 */
export function hardSpot(notes, stats, lengthBeats) {
  const diff = notes.map((n) => {
    const s = stats?.[n.id]
    if (!s || s.tries < MIN_TRIES) return null
    return 1 - s.rate + 0.35 * Math.min(1, s.abs / 120) + (s.techTries ? 0.25 * (1 - s.techOk / s.techTries) : 0)
  })
  const known = diff.filter((d) => d !== null)
  if (known.length < 3) return null
  const overall = mean(known)
  let best = null
  for (let len = 2; len <= Math.min(6, notes.length - 1); len++) {
    for (let i = 0; i + len <= notes.length; i++) {
      const w = diff.slice(i, i + len)
      if (w.some((d) => d === null)) continue
      // Une fenêtre plus longue doit être nettement plus dure pour l'emporter (on veut un point précis)
      const score = mean(w) - 0.02 * len
      if (!best || score > best.score) best = { start: i, end: i + len - 1, score, mean: mean(w) }
    }
  }
  if (!best || best.mean < 0.25 || best.mean < overall + 0.12) return null
  const rate = mean(notes.slice(best.start, best.end + 1).map((n) => stats[n.id].rate))
  const last = notes[best.end]
  return {
    start: best.start,
    end: best.end,
    rate,
    from: Math.floor(notes[best.start].beat),
    to: Math.min(lengthBeats, Math.ceil(last.beat + Math.max(last.dur ?? 0.25, 0.25) + 1e-6)),
  }
}

/**
 * Transitions où tu presses (la note suivante arrive plus tôt que la précédente) ou retiens : écart des
 * avances moyennes entre deux notes voisines, au-delà de 20 ms. [{ index (de la seconde note), ms }]
 */
export function timingDrifts(notes, stats) {
  const out = []
  for (let i = 1; i < notes.length; i++) {
    const a = stats?.[notes[i - 1].id]
    const b = stats?.[notes[i].id]
    if (!a || !b || a.hits < MIN_TRIES || b.hits < MIN_TRIES) continue
    const ms = Math.round(b.off - a.off)
    if (Math.abs(ms) >= 20) out.push({ index: i, ms })
  }
  return out.sort((x, y) => Math.abs(y.ms) - Math.abs(x.ms))
}

// ---------- Méthodes de progression ----------

export const METHODS = [
  { id: 'ladder', label: 'Paliers', hint: 'Le tempo monte d’un palier après N passages propres d’affilée, jusqu’à la cible.' },
  { id: 'adaptive', label: 'Adaptatif', hint: 'Monte après N passages propres, redescend après 2 ratés de suite : le tempo se cale sur ta limite du jour.' },
  { id: 'bursts', label: 'Rafales', hint: 'Un passage sur deux est joué plus vite : la vitesse de croisière paraît ensuite plus facile.' },
  { id: 'manual', label: 'Libre', hint: 'Pas de montée automatique : tu règles le tempo au métronome.' },
]

/** État de progression d'une séance (muté par nextTempo). */
export const progressState = () => ({ streak: 0, fails: 0, dir: 0, reversals: [] })

/**
 * Tempo de base après un passage. kind : 'base' ou 'burst' (méthode Rafales).
 * Renvoie { bpm, event } ; event : 'up' | 'down' | 'target' | 'burst-ok' | null.
 */
export function nextTempo(method, state, { clean, bpm, kind = 'base' }, p) {
  if (method === 'manual') return { bpm, event: null }
  if (kind === 'burst') return { bpm, event: clean ? 'burst-ok' : null } // la rafale ne compte pas pour monter
  const floor = Math.max(40, p.startBpm - 3 * p.step)
  if (clean) {
    state.fails = 0
    state.streak++
    if (state.streak < p.reps) return { bpm, event: null }
    state.streak = 0
    const cap = method === 'adaptive' ? 240 : p.targetBpm
    if (bpm >= cap) return { bpm, event: 'target' }
    if (state.dir < 0) state.reversals.push(bpm) // changement de sens : un point de la limite
    state.dir = 1
    const next = Math.min(cap, bpm + p.step)
    return { bpm: next, event: method === 'adaptive' || next < p.targetBpm ? 'up' : 'target' }
  }
  state.streak = 0
  if (method !== 'adaptive') return { bpm, event: null }
  state.fails++
  if (state.fails < 2 || bpm <= floor) return { bpm, event: null }
  state.fails = 0
  if (state.dir > 0) state.reversals.push(bpm)
  state.dir = -1
  return { bpm: Math.max(floor, bpm - p.step), event: 'down' }
}

/** Tempo maîtrisé estimé par la méthode Adaptatif : moyenne des derniers points de bascule. */
export const masteredTempo = (reversals) => (reversals.length >= 3 ? Math.round(mean(reversals.slice(-4))) : null)

/** Tempo d'un passage « rafale » : la base + burst %. */
export const burstTempo = (bpm, burst) => Math.min(240, Math.round(bpm * (1 + burst / 100)))

// ---------- Calage du micro ----------

/**
 * Correction du calage à partir des derniers écarts mesurés (ms) : la médiane, si elle est franche et
 * régulière (dispersion faible) — un retard toujours identique vient du micro, pas du guitariste.
 */
export function latencyCorrection(offsets) {
  if (offsets.length < 8) return 0
  const med = median(offsets)
  const spread = median(offsets.map((o) => Math.abs(o - med)))
  if (Math.abs(med) < 8 || spread > 35) return 0
  return Math.round(med * 0.7)
}

// ---------- Suivi dans le temps ----------

const DAY = 24 * 3600 * 1000

/** Maîtrise d'un phrasé (0–100) : son record propre rapporté à la cible. */
export const mastery = (p) => (p.targetBpm && p.bestBpm ? Math.round(100 * Math.min(1, p.bestBpm / p.targetBpm)) : 0)

/** Qualité d'une séance (0–5), pour la révision espacée : part de passages propres et tempo atteint. */
export function sessionQuality(session, p) {
  if (!session?.passes) return null
  const cleanRatio = session.clean / session.passes
  const reach = p.targetBpm ? Math.min(1, (session.bestBpm || 0) / p.targetBpm) : 0
  return Math.round(5 * (0.55 * cleanRatio + 0.45 * reach))
}

/**
 * Révision espacée (SM-2) : une bonne séance éloigne la prochaine (1 jour, 3 jours, puis ×facilité),
 * une séance difficile la ramène au lendemain.
 */
export function scheduleReview(review, q, now = Date.now()) {
  let { reps = 0, interval = 0, ease = 2.5 } = review ?? {}
  if (q < 3) {
    reps = 0
    interval = 1
  } else {
    reps++
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease)
  }
  ease = Math.max(1.3, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  return { reps, interval, ease, due: now + interval * DAY, last: now, q }
}

/** Le phrasé est à revoir aujourd'hui (jamais travaillé, ou date de révision passée). */
export const isDue = (p, now = Date.now()) => p.notes.length > 0 && (!p.review || p.review.due <= now)

/** « à revoir », « demain », « dans 3 j »… */
export function reviewLabel(p, now = Date.now()) {
  if (!p.notes.length) return ''
  if (!p.review) return 'nouveau'
  const days = Math.ceil((p.review.due - now) / DAY)
  return days <= 0 ? 'à revoir' : days === 1 ? 'demain' : `dans ${days} j`
}

/**
 * Projection : régression linéaire des records des dernières séances ; combien de séances encore pour
 * atteindre la cible, au rythme actuel. { slope (BPM / séance), sessions | null, line: [a, b] } ou null.
 */
export function projection(sessions, target) {
  const pts = sessions
    .map((s, i) => ({ x: i, y: s.bestBpm }))
    .filter((p) => p.y > 0)
    .slice(-8)
  if (pts.length < 3) return null
  const mx = mean(pts.map((p) => p.x))
  const my = mean(pts.map((p) => p.y))
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  if (!den) return null
  const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den
  const a = my - b * mx
  const last = pts.at(-1)
  if (last.y >= target) return { slope: b, sessions: 0, line: [a, b] }
  if (b < 0.3) return { slope: b, sessions: null, line: [a, b] }
  return { slope: b, sessions: Math.max(1, Math.ceil((target - (a + b * last.x)) / b)), line: [a, b] }
}
