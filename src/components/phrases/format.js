// Petits formats d'affichage de la page Phrasés

const FRACTIONS = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
]
/** 1.5 -> « 1½ », 0.25 -> « ¼ » */
export function fraction(x) {
  const whole = Math.floor(x + 1e-6)
  const rest = x - whole
  const f = FRACTIONS.find(([v]) => Math.abs(v - rest) < 1e-3)?.[1]
  if (rest < 1e-3) return String(whole)
  return f ? `${whole || ''}${f}` : x.toFixed(2).replace('.', ',')
}

/** Position d'un temps dans le phrasé : « 2.3 » (mesure 2, temps 3), « 1.2½ »… */
export function beatLabel(beat, beats) {
  const bar = Math.floor(beat / beats + 1e-6)
  return `${bar + 1}.${fraction(beat - bar * beats + 1)}`
}

/** Durée en temps : « ½ temps », « 1 temps », « 2 temps » */
export const durationLabel = (d) => `${fraction(d)} temps`

export const signature = (beats) => (beats === 6 ? '6/8' : `${beats}/4`)

export const offsetLabel = (ms) => (Math.abs(ms) < 10 ? 'pile dans le temps' : ms < 0 ? `${-ms} ms en avance` : `${ms} ms en retard`)

/** 754 s -> « 12 min », 4000 s -> « 1 h 07 » */
export function durationOf(seconds) {
  if (seconds < 60) return 'moins d’une minute'
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const DAY = 24 * 3600 * 1000
/** « aujourd'hui », « hier », « il y a 3 j », sinon la date */
export function dayLabel(at, now = Date.now()) {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} j`
  return new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
