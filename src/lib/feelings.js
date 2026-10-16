/**
 * Sensation produite en terminant une phrase sur chaque degré (intervalle depuis la tonique, 0–11).
 * Conventions d'écoute, pas des règles : l'effet dépend aussi de l'accord joué dessous.
 * `effect` choisit l'animation du texte dans le panneau combo (voir ComboPanel.vue).
 */
export const FEELINGS = [
  { degree: '1', word: 'Résolution', sub: 'retour à la maison, la phrase est conclue', effect: 'settle' },
  { degree: 'b2', word: 'Inquiétant', sub: 'sombre et tendu, couleur phrygienne', effect: 'glitch' },
  { degree: '2', word: 'Suspendu', sub: 'ouvert et aérien, comme une virgule', effect: 'float' },
  { degree: 'b3', word: 'Mélancolique', sub: 'la couleur du mineur', effect: 'melancholy' },
  { degree: '3', word: 'Lumineux', sub: 'chantant et stable, la couleur du majeur', effect: 'shine' },
  { degree: '4', word: 'En attente…', sub: 'veut redescendre sur la tierce', effect: 'lean' },
  { degree: 'b5', word: 'Grinçant', sub: 'le triton, la blue note qui frotte', effect: 'grind' },
  { degree: '5', word: 'Puissant', sub: 'solide et ouvert, comme un power chord', effect: 'punch' },
  { degree: 'b6', word: 'Dramatique', sub: 'sombre et épique', effect: 'drama' },
  { degree: '6', word: 'Nostalgique', sub: 'doux et un peu rétro', effect: 'vintage' },
  { degree: 'b7', word: 'Bluesy', sub: 'cool et détendu, appelle la suite', effect: 'swing' },
  { degree: '7', word: 'Intrigue', sub: 'la sensible, elle veut monter vers la tonique', effect: 'intrigue' },
]

export const feelingFor = (interval) => FEELINGS[((interval % 12) + 12) % 12]
