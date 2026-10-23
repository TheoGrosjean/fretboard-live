<script setup>
// Bilan de fin de séance, par-dessus le manche : passages, tempo gagné, record, prochaine révision.
import { computed, inject } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import { durationOf } from './format'

const s = inject(STUDIO_KEY)
const r = computed(() => s.summary)
const cleanPct = computed(() => Math.round((100 * r.value.clean) / r.value.passes))
const gained = computed(() => r.value.endBpm - r.value.startBpm)
</script>

<template>
  <div class="summary">
    <div class="flex items-start justify-between gap-6">
      <div>
        <div class="text-[10px] font-semibold tracking-widest text-copper-400 uppercase">Séance terminée</div>
        <div class="mt-1 text-2xl font-black text-white">
          <template v-if="r.record">Nouveau record · {{ r.bestBpm }} BPM 🏆</template>
          <template v-else-if="gained > 0">+{{ gained }} BPM aujourd'hui</template>
          <template v-else-if="cleanPct >= 70">Belle régularité</template>
          <template v-else>Ça rentre, continue</template>
        </div>
      </div>
      <button class="close" aria-label="Fermer le bilan" @click="s.summary = null">✕</button>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="cell"><b>{{ r.passes }}</b><span>passages</span></div>
      <div class="cell"><b>{{ cleanPct }} %</b><span>propres</span></div>
      <div class="cell"><b>{{ r.startBpm }} → {{ r.endBpm }}</b><span>tempo de base</span></div>
      <div class="cell"><b>{{ r.avgScore }}</b><span>score moyen</span></div>
    </div>
    <p class="mt-3 text-sm text-neutral-400">
      {{ durationOf(r.duration) }} de travail<template v-if="r.bestBpm"> · meilleur passage propre à {{ r.bestBpm }} BPM</template><template v-if="r.mastered"> · tempo maîtrisé estimé : {{ r.mastered }} BPM</template><template v-if="r.review"> · prochaine révision : <b class="text-neutral-200">{{ r.review }}</b></template>
    </p>
    <div class="mt-4 flex gap-2">
      <button class="again" @click="s.startPractice">Rejouer</button>
      <button class="later" @click="s.summary = null">Fermer</button>
    </div>
  </div>
</template>

<style scoped>
@reference "../../style.css";

.summary {
  @apply w-[min(36rem,calc(100%-2rem))] rounded-2xl p-5 shadow-2xl ring-1 ring-copper-400/30;
  background: radial-gradient(120% 140% at 0% 0%, rgba(226, 104, 58, 0.16), transparent 60%), #1a1817;
  animation: summary-in 0.35s cubic-bezier(0.2, 1.3, 0.4, 1);
}
@keyframes summary-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.97);
  }
}
.cell {
  @apply flex flex-col rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/5;
}
.cell b {
  @apply text-lg font-black text-white;
}
.cell span {
  @apply text-[11px] text-neutral-500;
}
.close {
  @apply flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-white/5 hover:text-white;
}
.again {
  @apply h-9 rounded-xl bg-copper-500 px-4 text-sm font-bold text-white hover:bg-copper-400;
}
.later {
  @apply h-9 rounded-xl px-4 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 hover:bg-white/5;
}
</style>
