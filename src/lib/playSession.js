/**
 * Arbitre du mode Jouer : compare les notes détectées aux notes attendues, compte le score, la série,
 * le multiplicateur, et fait évoluer la difficulté dynamique section par section.
 *
 * Tous les temps sont en secondes « réelles » (déjà divisés par la vitesse de lecture).
 * La détection ne sait pas sur quelle corde on joue : seule la hauteur (et le moment) compte. Sur un accord,
 * une seule note suffit (la détection suit une note à la fois).
 */
import { LEVELS } from './songChart'

const EARLY = 0.16 // s : on peut jouer un peu en avance…
const LATE = 0.2 // …ou un peu en retard
const PERFECT = 0.07
const POINTS = { perfect: 100, good: 60 }
const STREAK_STEP = 10 // notes de suite pour passer au multiplicateur suivant
const MAX_MULT = 4
const LEVEL_UP = 0.9 // précision d'une section pour monter d'un niveau…
const LEVEL_DOWN = 0.5 // …ou en descendre

/**
 * notes : [{ id, t (temps réel), midi, tier, chord, section, dead }] ; sections : [{ index, name, t0, t1 }]
 * levels : niveaux par nom de section (partagés entre parties du morceau qui se répètent), ou null (toutes les notes).
 */
export function createPlaySession({ notes, sections, dynamic, startLevel = 2, levels = {} }) {
  const s = {
    score: 0,
    streak: 0,
    bestStreak: 0,
    hits: 0,
    perfects: 0,
    misses: 0,
    dynamic,
    levels: { ...levels },
    state: new Map(), // id -> 'hit' | 'miss'
    sectionStats: sections.map(() => ({ hits: 0, total: 0 })),
    sectionDone: new Set(),
    events: [], // à afficher : { type: 'hit' | 'miss' | 'level', ... }
  }
  const levelOf = (sectionIndex) => (dynamic ? (s.levels[sections[sectionIndex]?.name] ?? startLevel) : LEVELS)
  /** Note affichée et attendue au niveau actuel de sa section ? */
  s.isVisible = (n) => !n.dead && n.tier < levelOf(n.section)
  s.multiplier = () => Math.min(MAX_MULT, 1 + Math.floor(s.streak / STREAK_STEP))

  function judge(n, kind, dt = 0) {
    s.state.set(n.id, kind)
    const stats = s.sectionStats[n.section]
    if (stats) stats.total++
    if (kind === 'miss') {
      s.misses++
      s.streak = 0
      s.events.push({ type: 'miss', id: n.id })
      return
    }
    const perfect = Math.abs(dt) <= PERFECT
    const before = s.multiplier()
    s.streak++
    s.bestStreak = Math.max(s.bestStreak, s.streak)
    s.hits++
    if (perfect) s.perfects++
    if (stats) stats.hits++
    s.score += (perfect ? POINTS.perfect : POINTS.good) * s.multiplier()
    s.events.push({ type: 'hit', id: n.id, perfect, dt })
    if (s.multiplier() > before) s.events.push({ type: 'mult', mult: s.multiplier() })
  }

  /** Note entendue (MIDI) à l'instant `t` : renvoie la note validée, ou null. */
  s.played = (midi, t) => {
    // Accords à jouer en ce moment (au moins une note affichée et pas encore jouée)
    const openChords = new Set()
    for (const n of notes) {
      if (n.t > t + EARLY) break
      if (n.chord && n.t >= t - LATE && !s.state.has(n.id) && s.isVisible(n)) openChords.add(n.chord)
    }
    let best = null
    for (const n of notes) {
      if (n.t > t + EARLY) break
      // Une note d'accord masquée par la difficulté dynamique compte aussi : on gratte souvent tout l'accord
      if (n.t < t - LATE || s.state.has(n.id) || !(s.isVisible(n) || openChords.has(n.chord))) continue
      const diff = Math.abs(midi - n.midi)
      if (diff !== 0 && diff !== 12) continue // la détection se trompe parfois d'octave
      if (!best || Math.abs(n.t - t) < Math.abs(best.t - t)) best = n
    }
    if (best && !s.isVisible(best)) best = notes.find((n) => n.chord === best.chord && !s.state.has(n.id) && s.isVisible(n))
    if (!best) return null
    judge(best, 'hit', t - best.t)
    // Accord : une note entendue valide tout l'accord (sans compter de points en plus)
    if (best.chord)
      for (const n of notes)
        if (n.chord === best.chord && n.id !== best.id && !s.state.has(n.id) && s.isVisible(n)) {
          s.state.set(n.id, 'hit')
          s.events.push({ type: 'hit', id: n.id, perfect: Math.abs(t - best.t) <= PERFECT, silent: true })
        }
    return best
  }

  /** À chaque image : notes dépassées = ratées ; fin de section = bilan et difficulté. */
  s.tick = (t) => {
    for (const n of notes) {
      if (n.t > t - LATE) break
      if (s.state.has(n.id) || !s.isVisible(n)) continue
      judge(n, 'miss')
      // Accord raté : compté une seule fois, comme un accord réussi
      if (n.chord)
        for (const m of notes)
          if (m.chord === n.chord && !s.state.has(m.id)) {
            s.state.set(m.id, 'miss')
            s.events.push({ type: 'miss', id: m.id })
          }
    }
    sections.forEach((sec, i) => {
      if (s.sectionDone.has(i) || t < sec.t1) return
      s.sectionDone.add(i)
      const st = s.sectionStats[i]
      if (!dynamic || !st.total) return
      const acc = st.hits / st.total
      const lvl = levelOf(i)
      const next = acc >= LEVEL_UP ? Math.min(LEVELS, lvl + 1) : acc < LEVEL_DOWN ? Math.max(1, lvl - 1) : lvl
      if (next !== lvl) {
        s.levels[sec.name] = next
        s.events.push({ type: 'level', up: next > lvl, level: next, section: sec.name })
      }
    })
  }

  /** Riff Repeater : on rejoue une section, ses notes redeviennent à jouer. */
  s.resetSection = (index) => {
    for (const n of notes) if (n.section === index) s.state.delete(n.id)
    s.sectionStats[index] = { hits: 0, total: 0 }
    s.sectionDone.delete(index)
  }

  s.accuracy = () => (s.hits + s.misses ? s.hits / (s.hits + s.misses) : 0)
  s.levelOf = levelOf
  return s
}
