import { ref } from 'vue'

/** Ampli virtuel allumé ? Partagé entre les pages (voyant sur l'onglet, rappel en mode jeu). */
export const ampOn = ref(false)

/**
 * Jam « un seul joueur à la fois » : seule l'entrée de ce joueur (0 ou 1) passe dans l'ampli ;
 * null = les deux entrées sont entendues.
 */
export const soloPlayer = ref(null)
