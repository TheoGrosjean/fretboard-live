<script setup>
// Raccourcis clavier de la page Phrasés
import { inject } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'

const s = inject(STUDIO_KEY)
const KEYS = [
  [['Espace'], 'S’entraîner / arrêter'],
  [['R'], 'Enregistrer sur le clic / terminer'],
  [['L'], 'Prise libre / terminer'],
  [['↑', '↓'], 'Tempo ±1 BPM (Maj : ±5)'],
  [['←', '→'], 'Note sélectionnée : une case plus tôt / plus tard (sinon : rythme du clic)'],
  [['Maj', '←', '→'], 'Tout le phrasé d’une case'],
  [['Suppr'], 'Supprimer la note sélectionnée'],
  [['⌘', 'Z'], 'Annuler (Maj : rétablir)'],
  [['1', '2', '3'], 'Studio, Entraînement, Progrès'],
  [['M'], 'Replier / afficher le manche'],
  [['Échap'], 'Arrêter, ou désélectionner'],
  [['?'], 'Afficher / masquer cette aide'],
]
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="s.helpOpen = false">
    <div class="w-full max-w-lg rounded-2xl bg-[#1a1817] p-6 shadow-2xl ring-1 ring-white/10" role="dialog" aria-label="Raccourcis clavier">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Raccourcis clavier</h3>
        <button class="text-neutral-500 hover:text-white" aria-label="Fermer" @click="s.helpOpen = false">✕</button>
      </div>
      <dl class="space-y-2 text-sm">
        <div v-for="[keys, what] in KEYS" :key="what" class="flex items-center justify-between gap-4">
          <dt class="flex shrink-0 gap-1"><kbd v-for="k in keys" :key="k">{{ k }}</kbd></dt>
          <dd class="text-right text-neutral-300">{{ what }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
@reference "../../style.css";

kbd {
  @apply inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-neutral-800 px-1.5 font-sans text-xs font-semibold text-neutral-200 ring-1 ring-white/10;
}
</style>
