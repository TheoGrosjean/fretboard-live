/**
 * Choix de la corde / case pour une suite de notes, à partir de la seule hauteur.
 *
 * Une même note existe à plusieurs endroits du manche : plutôt que de décider note par note,
 * on cherche le doigté le plus jouable sur toute la phrase récente (algorithme de Viterbi).
 * Une note peut ainsi être replacée après coup quand les suivantes lèvent l'ambiguïté.
 *
 * Coût d'un enchaînement de deux positions :
 *  - dans l'écart de la main (≈ une « box » de 4 cases), ce sont les doigts qui bougent : presque gratuit
 *  - au-delà, la main se déplace : coût élevé, croissant avec la distance
 *  - changement de corde, légèrement pénalisé
 *  - corde à vide : naturelle en bas du manche, rare quand la main est haut
 *  - note legato (slide, hammer-on) : elle reste normalement sur la même corde
 * Et pour chaque note, un léger rappel vers la position de la main (connue, ou à défaut la box 1
 * de la gamme : case de la tonique sur la corde de Mi grave) — à hauteur égale, une box à la case 5
 * et la position ouverte sont indiscernables, il faut un a priori pour trancher.
 */

export const PHRASE_LENGTH = 16 // notes optimisées ensemble (la phrase repart après un silence)
export const PHRASE_GAP_MS = 1500 // silence qui termine une phrase
export const REVISABLE = 6 // seules les dernières notes peuvent encore changer de place à l'écran
const FINGER_REACH = 3 // écart en cases couvert par les doigts sans déplacer la main
const DEFAULT_HAND = { fret: 6.5, string: 3 } // main supposée au départ, sans autre information
const ANCHOR_WEIGHT = 0.6 // force du rappel vers la position de la main
const ANCHOR_HALF_WIDTH = 2 // demi-largeur de la fenêtre de la main (pas de rappel à l'intérieur)

/** Coût du déplacement en cases entre deux notes. */
function fretMove(a, b) {
  // Corde à vide : rien à appuyer, naturelle si la main est en bas du manche
  if (a.fret === 0 || b.fret === 0) {
    const fretted = a.fret === 0 ? b.fret : a.fret
    return fretted <= FINGER_REACH + 2 ? 0.3 : 2 + fretted / 3
  }
  const d = Math.abs(a.fret - b.fret)
  return d <= FINGER_REACH ? d * 0.15 : 0.5 + (d - FINGER_REACH) * 2
}

/** Coût pour jouer `to` juste après `from`. */
export function transitionCost(from, to, legato = false) {
  let cost = fretMove(from, to) + Math.abs(from.string - to.string) * 0.15
  if (legato && from.string !== to.string) cost += 6
  return cost
}

/** Rappel vers la fenêtre de la main (centre ± 2 cases) ; une corde à vide compte comme la case 0. */
const anchorCost = (center, to) => ANCHOR_WEIGHT * Math.max(0, Math.abs(to.fret - center.fret) - ANCHOR_HALF_WIDTH)

/** Box 1 de la gamme : main posée à partir de la case de la tonique sur la corde de Mi grave. */
// (centre une case au-dessus : couvre les boxes mineures r…r+3 comme majeures r−1…r+2)
export const rootBox = (root, lowString = 40) => ({ fret: ((((root - lowString) % 12) + 12) % 12) + 1, string: 3 })

/**
 * Meilleur doigté pour une phrase.
 * notes : [{ candidates: [{ string, fret }], legato }] — une seule candidate pour une position imposée (clic)
 * hand  : position de la main avant la phrase, ou null
 * prior : position supposée sans autre information (ex. box 1 de la gamme), ou null
 * Renvoie la position choisie pour chaque note.
 */
export function bestFingering(notes, hand = null, prior = null) {
  if (!notes.length) return []
  const center = hand ?? prior ?? DEFAULT_HAND
  // cost[i][k] = coût minimal pour finir la note i sur sa candidate k ; from[i][k] = candidate précédente
  let cost = notes[0].candidates.map((c) => (hand ? transitionCost(hand, c) : 0) + anchorCost(center, c))
  const from = [notes[0].candidates.map(() => -1)]

  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1].candidates
    const next = notes[i].candidates.map((c) => {
      let best = Infinity
      let bestK = 0
      prev.forEach((p, k) => {
        const total = cost[k] + transitionCost(p, c, notes[i].legato) + anchorCost(center, c)
        if (total < best) {
          best = total
          bestK = k
        }
      })
      return [best, bestK]
    })
    cost = next.map(([c]) => c)
    from.push(next.map(([, k]) => k))
  }

  // Remontée du meilleur chemin
  let k = cost.indexOf(Math.min(...cost))
  const path = []
  for (let i = notes.length - 1; i >= 0; i--) {
    path[i] = notes[i].candidates[k]
    k = from[i][k]
  }
  return path
}

/**
 * Position de la main déduite des dernières notes jouées (hors cordes à vide) : milieu de l'étendue
 * des cases utilisées, c.-à-d. le centre de la box en cours (une moyenne dériverait vers les notes du bord).
 */
export function handFrom(positions) {
  const fretted = positions.filter((p) => p.fret > 0).slice(-4)
  if (!fretted.length) return null
  const frets = fretted.map((p) => p.fret)
  const strings = fretted.map((p) => p.string)
  return { fret: (Math.min(...frets) + Math.max(...frets)) / 2, string: (Math.min(...strings) + Math.max(...strings)) / 2 }
}
