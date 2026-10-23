/**
 * Petit son de guitare synthétique pour la page Théorie : notes une par une, accord gratté,
 * ou suite d'accords. Indépendant de l'ampli et de l'entrée audio.
 */
let ctx = null
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12)

const note = (midi, t, level, length) => noteTo(ctx, ctx.destination, midi, t, level, length)

/**
 * Joue `notes` (MIDI) l'une après l'autre ; chord : grattées ensemble.
 * notes peut être une suite d'accords [[…], […]] : chaque accord est gratté, l'un après l'autre.
 * Renvoie la durée en secondes.
 */
export function pluck(notes, { chord = false, gap = 0.34 } = {}) {
  ctx ??= new AudioContext()
  ctx.resume()
  const t0 = ctx.currentTime + 0.04
  if (Array.isArray(notes[0])) {
    notes.forEach((c, i) => strum(c, t0 + i * 1.1, 1.3))
    return notes.length * 1.1 + 0.3
  }
  if (chord) {
    strum(notes, t0, 2.4)
    return 2.4
  }
  notes.forEach((m, i) => note(m, t0 + i * gap, 0.2, 1.2))
  return notes.length * gap + 1
}

function strum(notes, t, length) {
  const level = 0.32 / Math.sqrt(notes.length)
  notes.forEach((m, i) => note(m, t + i * 0.025, level, length))
}

/**
 * Joue une suite de notes placées dans le temps : [{ midi, at (s depuis le départ), length? (s), level?,
 * bend? (demi-tons tirés), release?, glideFrom? (slide depuis cette note), soft? (lié : attaque douce) }].
 * Renvoie { stop, duration } ; stop() coupe tout de suite (bouton Arrêter).
 */
export function pluckTimed(notes) {
  ctx ??= new AudioContext()
  ctx.resume()
  const out = ctx.createGain()
  out.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.06
  // Les notes passent par `out` pour pouvoir toutes les couper d'un coup
  notes.forEach((n) => noteTo(ctx, out, n.midi, t0 + n.at, (n.level ?? 0.22) * (n.soft ? 0.6 : 1), Math.max(0.35, Math.min(1.4, n.length ?? 1)), n))
  const duration = notes.length ? Math.max(...notes.map((n) => n.at + (n.length ?? 1))) : 0
  return {
    duration,
    stop: () => {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.02)
      setTimeout(() => out.disconnect(), 200)
    },
  }
}

/**
 * Une note de guitare synthétique dans un contexte audio donné (la démo de la page Phrasés passe par
 * l'horloge du métronome). Mêmes options que pluckTimed.
 */
export const pluckVoice = (c, dest, n, t) => noteTo(c, dest, n.midi, t, (n.level ?? 0.22) * (n.soft ? 0.6 : 1), Math.max(0.35, Math.min(1.4, n.length ?? 1)), n)

function noteTo(ctx, dest, midi, t, level, length, { bend = 0, release = false, glideFrom = null } = {}) {
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = freq(midi)
  if (glideFrom !== null) {
    // Slide : la hauteur part de la note précédente et glisse jusqu'à la note
    osc.frequency.setValueAtTime(freq(glideFrom), t)
    osc.frequency.exponentialRampToValueAtTime(freq(midi), t + Math.min(0.12, length * 0.4))
  }
  if (bend) {
    // Bend : la note est tirée peu après l'attaque, puis éventuellement relâchée
    const up = t + Math.min(0.06, length * 0.15)
    const top = up + Math.min(0.14, length * 0.3)
    osc.frequency.setValueAtTime(freq(midi), up)
    osc.frequency.linearRampToValueAtTime(freq(midi + bend), top)
    if (release) {
      osc.frequency.setValueAtTime(freq(midi + bend), top + length * 0.25)
      osc.frequency.linearRampToValueAtTime(freq(midi), top + length * 0.25 + 0.12)
    }
  }
  // Le filtre se referme comme le son d'une corde qui s'éteint
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(Math.min(freq(midi) * 10, 9000), t)
  tone.frequency.exponentialRampToValueAtTime(freq(midi) * 1.5, t + length * 0.6)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(level, t + 0.004)
  amp.gain.exponentialRampToValueAtTime(0.0005, t + length)
  osc.connect(tone).connect(amp).connect(dest)
  osc.start(t)
  osc.stop(t + length + 0.05)
}
