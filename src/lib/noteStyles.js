/**
 * Apparence des notes du manche : pastille sombre avec le nom de la note et son degré en dessous.
 * Les couleurs viennent d'une palette (tonique, note jouée, autres positions, hors gamme).
 */

export const PALETTES = [
  { id: 'ocean', name: 'Bleu océan', root: '#38bdf8', played: '#0ea5e9', playedText: '#ffffff', alternate: '#7dd3fc', outside: '#f43f5e', sub: '#7dd3fc' },
  { id: 'violet', name: 'Violet', root: '#c084fc', played: '#a855f7', playedText: '#ffffff', alternate: '#d8b4fe', outside: '#f43f5e', sub: '#d8b4fe' },
  { id: 'copper', name: 'Cuivre (assorti au bois)', root: '#f0956a', played: '#e2683a', playedText: '#ffffff', alternate: '#fdba9a', outside: '#ef4444', sub: '#f5b48f' },
  { id: 'ice', name: 'Blanc glacier', root: '#f8fafc', played: '#f8fafc', playedText: '#0f172a', alternate: '#cbd5e1', outside: '#f43f5e', sub: '#94a3b8' },
]

export const DEFAULT_PALETTE = 'copper'

export const findPalette = (id) => PALETTES.find((p) => p.id === id) ?? PALETTES[0]

const SIZE = 40

/** Note de la gamme : pastille sombre, contour coloré pour la tonique, degré sous le nom. */
export function scaleMark(info, label, palette) {
  return {
    shape: 'circle',
    size: SIZE,
    fill: '#1c1917',
    stroke: info.isRoot ? palette.root : '#78716c',
    strokeWidth: info.isRoot ? 2.5 : 1.5,
    textColor: '#fafaf9',
    fontSize: 13,
    // En mode « degrés », le nom affiché est déjà le degré : pas de seconde ligne ; mode jeu difficile : rien
    sub: !label || info.degree === label ? '' : info.degree,
    subColor: info.isRoot ? palette.root : palette.sub,
  }
}

/** Note jouée : pastille agrandie et remplie. */
export function playedMark(palette, { outside }) {
  return {
    shape: 'circle',
    size: SIZE + 8,
    fill: outside ? palette.outside : palette.played,
    textColor: outside ? '#ffffff' : palette.playedText,
    fontSize: 17,
    filter: 'url(#lift)',
  }
}

/** Autres positions de la note jouée : contour en pointillés. */
export function alternateMark(palette, { outside }) {
  const color = outside ? palette.outside : palette.alternate
  return { shape: 'circle', size: SIZE, fill: '#1c1917', fillOpacity: 0.85, stroke: color, strokeWidth: 2, dashed: true, textColor: color }
}

/** Finitions unies du corps de la guitare. */
// accent : teintes 300 → 600 de la couleur d'accent du site, assortie à la finition
const COPPER = ['#f5b48f', '#f0956a', '#e2683a', '#c2522a']
export const BODY_FINISHES = [
  { id: 'black', name: 'Noir satiné', color: '#1c1c1e', accent: COPPER },
  { id: 'cream', name: 'Crème vintage', color: '#e6dcc6', accent: ['#f3dcae', '#e8c47e', '#d4a24c', '#b08433'] },
  { id: 'copper', name: 'Cuivre métallisé', color: '#a8552f', accent: COPPER },
  { id: 'burgundy', name: 'Bordeaux', color: '#5e1a26', accent: ['#f4a7b4', '#ec7a8e', '#d94a64', '#b3324b'] },
  { id: 'navy', name: 'Bleu nuit', color: '#1b2a44', accent: ['#b0c9f6', '#82a8ee', '#5784dc', '#3d68bf'] },
  { id: 'sonic', name: 'Sonic Blue', color: '#8fb1c4', accent: ['#bfe2f0', '#8fcbe2', '#5fb2d1', '#4593b2'] },
]

export const DEFAULT_BODY_FINISH = 'black'

export const findBodyFinish = (id) => BODY_FINISHES.find((f) => f.id === id) ?? BODY_FINISHES[0]

/** Palette « cuivre » des notes recolorée avec l'accent de la finition. */
export function accentPalette(palette, finishId) {
  if (palette.id !== 'copper') return palette
  const [a300, a400, a500] = findBodyFinish(finishId).accent
  return { ...palette, root: a400, played: a500, alternate: a300, sub: a300 }
}

/** Applique l'accent de la finition aux variables CSS du site (--color-copper-*). */
export function applyAccent(finishId) {
  const accent = findBodyFinish(finishId).accent
  ;[300, 400, 500, 600].forEach((n, i) => document.documentElement.style.setProperty(`--color-copper-${n}`, accent[i]))
}
