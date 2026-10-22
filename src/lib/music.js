export const NOTE_NAMES = {
  en: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  fr: ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'],
}

const DEFAULT_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7']

// Cordes de la plus aiguë (1) à la plus grave (6), en numéros MIDI
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]

/** Accordages proposés (notes MIDI des cordes à vide, de la corde aiguë à la grave). */
export const TUNINGS = [
  { id: 'standard', name: '6 cordes · Standard', notes: STANDARD_TUNING },
  { id: 'drop-d', name: '6 cordes · Drop D', notes: [64, 59, 55, 50, 45, 38] },
  { id: 'eb', name: '6 cordes · Mi♭ (½ ton plus bas)', notes: [63, 58, 54, 49, 44, 39] },
  { id: 'seven', name: '7 cordes · Standard (Si grave)', notes: [64, 59, 55, 50, 45, 40, 35] },
  { id: 'seven-drop-a', name: '7 cordes · Drop A', notes: [64, 59, 55, 50, 45, 40, 33] },
]
export const findTuning = (id) => TUNINGS.find((t) => t.id === id) ?? TUNINGS[0]

export const SCALES = [
  { id: 'major', name: 'Majeure (ionien)', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Mineure naturelle (éolien)', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic-minor', name: 'Mineure harmonique', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic-minor', name: 'Mineure mélodique', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'penta-major', name: 'Pentatonique majeure', intervals: [0, 2, 4, 7, 9] },
  { id: 'penta-minor', name: 'Pentatonique mineure', intervals: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  { id: 'dorian', name: 'Dorien', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygien', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydien', intervals: [0, 2, 4, 6, 7, 9, 11], labels: { 6: '#4' } },
  { id: 'mixolydian', name: 'Mixolydien', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrien', intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'phrygian-dominant', name: 'Phrygien dominant', intervals: [0, 1, 4, 5, 7, 8, 10] },
  { id: 'whole-tone', name: 'Par tons', intervals: [0, 2, 4, 6, 8, 10], labels: { 6: '#4', 8: '#5' } },
  { id: 'diminished', name: 'Diminuée (ton / demi-ton)', intervals: [0, 2, 3, 5, 6, 8, 9, 11], labels: { 9: 'bb7' } },
]

export const ARPEGGIOS = [
  { id: 'maj', name: 'Majeur', intervals: [0, 4, 7] },
  { id: 'min', name: 'Mineur', intervals: [0, 3, 7] },
  { id: 'dim', name: 'Diminué', intervals: [0, 3, 6] },
  { id: 'aug', name: 'Augmenté', intervals: [0, 4, 8], labels: { 8: '#5' } },
  { id: 'sus2', name: 'Sus2', intervals: [0, 2, 7] },
  { id: 'sus4', name: 'Sus4', intervals: [0, 5, 7] },
  { id: '6', name: '6', intervals: [0, 4, 7, 9] },
  { id: 'm6', name: 'm6', intervals: [0, 3, 7, 9] },
  { id: '7', name: '7 (dominante)', intervals: [0, 4, 7, 10] },
  { id: 'maj7', name: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'm7', name: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'mmaj7', name: 'm(maj7)', intervals: [0, 3, 7, 11] },
  { id: 'm7b5', name: 'm7b5 (demi-diminué)', intervals: [0, 3, 6, 10] },
  { id: 'dim7', name: 'dim7', intervals: [0, 3, 6, 9], labels: { 9: 'bb7' } },
  { id: 'add9', name: 'add9', intervals: [0, 2, 4, 7], labels: { 2: '9' } },
  { id: '9', name: '9', intervals: [0, 2, 4, 7, 10], labels: { 2: '9' } },
  { id: 'maj9', name: 'maj9', intervals: [0, 2, 4, 7, 11], labels: { 2: '9' } },
  { id: 'm9', name: 'm9', intervals: [0, 2, 3, 7, 10], labels: { 2: '9' } },
]

export const pitchClass = (midi) => ((Math.round(midi) % 12) + 12) % 12

export const freqToMidi = (freq) => 69 + 12 * Math.log2(freq / 440)

export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12)

export function noteName(midi, notation = 'en', withOctave = false) {
  const name = NOTE_NAMES[notation][pitchClass(midi)]
  if (!withOctave) return name
  // Convention anglo-saxonne : C4 = do central. Convention française : Do3.
  const octave = Math.floor(Math.round(midi) / 12) - (notation === 'fr' ? 2 : 1)
  return `${name}${octave}`
}

export function degreeLabel(interval, pattern) {
  return pattern?.labels?.[interval] ?? DEFAULT_DEGREES[interval]
}

/**
 * Notes de la gamme/arpège sélectionné : Map pitchClass -> { interval, degree, isRoot }
 */
export function buildOverlay(root, pattern) {
  const map = new Map()
  if (!pattern) return map
  for (const interval of pattern.intervals) {
    map.set((root + interval) % 12, {
      interval,
      degree: degreeLabel(interval, pattern),
      isRoot: interval === 0,
    })
  }
  return map
}

/** Toutes les positions (corde, case) où une note MIDI peut être jouée */
export function findPositions(midi, tuning, frets) {
  const positions = []
  tuning.forEach((open, string) => {
    const fret = Math.round(midi) - open
    if (fret >= 0 && fret <= frets) positions.push({ string, fret })
  })
  return positions
}
