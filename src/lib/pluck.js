/**
 * Petit son de guitare synthétique pour la page Théorie : notes une par une, accord gratté,
 * ou suite d'accords. Indépendant de l'ampli et de l'entrée audio.
 */
let ctx = null
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12)

function note(midi, t, level, length) {
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = freq(midi)
  // Le filtre se referme comme le son d'une corde qui s'éteint
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(Math.min(freq(midi) * 10, 9000), t)
  tone.frequency.exponentialRampToValueAtTime(freq(midi) * 1.5, t + length * 0.6)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(level, t + 0.004)
  amp.gain.exponentialRampToValueAtTime(0.0005, t + length)
  osc.connect(tone).connect(amp).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

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
