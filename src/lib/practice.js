import { ref } from 'vue'

/**
 * Demande de la page Théorie : ouvrir le Manche réglé sur une gamme / un accord
 * ({ overlayType, root, scaleId?, arpeggioId?, chordId?, boxIndex }). Le Manche l'applique puis la remet à null.
 */
export const practiceRequest = ref(null)
