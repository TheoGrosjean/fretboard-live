/**
 * Devine la tonalité d'un morceau à partir de son titre, ex. « Slow Blues Backing Track in A minor »,
 * « Am Jam », « Groove en Ré dorien », « Bb Mixolydian Vamp ».
 * Renvoie { root, scale?, quality?, text } ou null si rien de fiable n'est trouvé.
 *   root    : classe de hauteur 0–11
 *   scale   : id de gamme (voir SCALES) quand le titre précise le mode
 *   quality : 'minor' | 'major' quand seule la couleur est donnée
 */

const EN_NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const FR_NOTES = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 }

// Mots qui suivent la note ; testés dans l'ordre (les plus précis d'abord)
const MODES = [
  [/^(harmonic minor|minor harmonic|mineur harmonique)\b/, { scale: 'harmonic-minor' }],
  [/^(melodic minor|minor melodic|mineur melodique)\b/, { scale: 'melodic-minor' }],
  [/^(minor|mineur|min|moll)[\s-]*(pentatonic|pentatonique|penta)\b/, { scale: 'penta-minor' }],
  [/^(major|majeur|maj|dur)[\s-]*(pentatonic|pentatonique|penta)\b/, { scale: 'penta-major' }],
  [/^(minor|mineur|min)[\s-]*blues\b/, { scale: 'blues' }],
  [/^(phrygian dominant|phrygien dominant)\b/, { scale: 'phrygian-dominant' }],
  [/^(dorian|dorien)\b/, { scale: 'dorian' }],
  [/^(phrygian|phrygien)\b/, { scale: 'phrygian' }],
  [/^(lydian|lydien)\b/, { scale: 'lydian' }],
  [/^(mixolydian|mixolydien|mixo)\b/, { scale: 'mixolydian' }],
  [/^(locrian|locrien)\b/, { scale: 'locrian' }],
  [/^(aeolian|eolien)\b/, { scale: 'minor' }],
  [/^(ionian|ionien)\b/, { scale: 'major' }],
  [/^(minor|mineur|min|moll)\b/, { quality: 'minor' }],
  [/^(major|majeur|maj|dur)\b/, { quality: 'major' }],
  [/^blues\b/, { scale: 'blues' }],
]

// Sans mot de mode, on n'accepte une note isolée (« in A », « Am ») que dans un titre clairement musical
const MUSIC_CONTEXT = /backing|track|jam\b|groove|blues|improv|solo|\bkey\b|tonalit|play[\s-]?along|\bloop|vamp|tonart/i

const accidentalShift = (acc) => {
  if (!acc) return 0
  const a = acc.trim().toLowerCase()
  return a === '#' || a.endsWith('sharp') || a.endsWith('diese') ? 1 : -1
}

function normalize(title) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // « Ré », « dièse », « éolien » -> sans accents
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
}

function matchMode(rest) {
  const words = rest.replace(/^[\s\-–:,]+/, '').toLowerCase()
  for (const [re, result] of MODES) if (re.test(words)) return result
  return null
}

export function keyFromTitle(rawTitle) {
  if (!rawTitle) return null
  const title = normalize(rawTitle)
  const musical = MUSIC_CONTEXT.test(title)
  const candidates = []

  // Notation anglo-saxonne : A, Bb, F#, C-sharp, E flat… et en minuscules (« a minor », « bb minor »)
  const en = /(?<![\p{L}\d#])([A-Ga-g])(#|b(?![a-ln-z])|[\s-]?sharp\b|[\s-]?flat\b)?/gu
  for (const m of title.matchAll(en)) {
    const root = (EN_NOTES[m[1].toUpperCase()] + accidentalShift(m[2]) + 12) % 12
    const rest = title.slice(m.index + m[0].length)
    const before = title.slice(0, m.index)

    // En minuscule, « a » ou « e » sont surtout des mots courants (« just a minor problem ») :
    // on exige un mot de mode, et une note en début de titre, après « in / key of », ou un titre musical
    if (m[1] === m[1].toLowerCase()) {
      if (/^[\p{L}\d]/u.test(rest)) continue
      const mode = matchMode(rest)
      const placed = !before.trim() || /(\bin|\bkey of|\bkey|\ben)\s+$/i.test(before)
      if (mode && (placed || musical)) candidates.push({ root, ...mode, score: 3, text: m[0].toUpperCase() })
      continue
    }

    // Forme compacte : Am, F#m, Bbm7, Cmaj
    const compact = /^(maj|min|m)(?![\p{L}])/u.exec(rest)
    if (compact) {
      if (musical) candidates.push({ root, quality: compact[1] === 'maj' ? 'major' : 'minor', score: 2, text: m[0] + compact[0] })
      continue
    }
    if (/^[\p{L}\d]/u.test(rest)) continue // la lettre fait partie d'un mot (« And », « Ebony »)

    const mode = matchMode(rest)
    if (mode) {
      candidates.push({ root, ...mode, score: 3, text: m[0] })
      continue
    }
    // Note seule : « in A », « key of E », « en Sol » dans un titre musical
    const after = rest.trimStart()
    if (musical && /(\bin|\bkey of|\bkey|\ben|\btonalite de|\btonalite)\s+$/i.test(before) && (!after || /^[-–(|,[/:]/.test(after) || MUSIC_CONTEXT.test(after.split(/\s+/)[0]))) {
      candidates.push({ root, score: 1, text: m[0] })
    }
  }

  // Notation française : Do, Ré, Fa#, Si bémol… (exige un mot de mode : « la », « si », « do » sont aussi des mots courants)
  const fr = /(?<![\p{L}])(do|re|mi|fa|sol|la|si)(#|b(?![a-z])|\s?diese\b|\s?bemol\b)?(?![\p{L}])/giu
  for (const m of title.matchAll(fr)) {
    const mode = matchMode(title.slice(m.index + m[0].length))
    if (mode) candidates.push({ root: (FR_NOTES[m[1].toLowerCase()] + accidentalShift(m[2]) + 12) % 12, ...mode, score: 3, text: m[0] })
  }

  if (!candidates.length) return null
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a))
  const { score: _score, ...result } = best // le score ne sert qu’au choix
  return result
}
