<script setup>
// Calibration du micro : une note sur chaque clic (8 fois). La médiane des retards mesurés donne le calage
// de ton installation (interface, micro, détection) ; leur dispersion dit si la mesure est fiable.
import { computed, inject } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'

const s = inject(STUDIO_KEY)
const c = computed(() => s.calibration)
const running = computed(() => s.mode === 'calibrate')
const NOTES = 8
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="s.closeCalibration">
    <div class="dialog" role="dialog" aria-label="Calibrer le micro">
      <div class="text-[10px] font-semibold tracking-widest text-copper-400 uppercase">Calibrer le micro</div>
      <template v-if="running">
        <h3 class="mt-1 text-xl font-black text-white">{{ s.counting ? `Prêt… ${s.countdown}` : 'Une note sur chaque clic' }}</h3>
        <p class="mt-1 text-sm text-neutral-400">Une note courte et franche (corde étouffée bienvenue), pile sur le clic.</p>
        <div class="mt-5 flex justify-center gap-2">
          <span v-for="k in NOTES" :key="k" class="dot" :class="{ on: k <= c.offsets.length }" />
        </div>
        <p class="mt-4 text-center text-xs text-neutral-500 tabular-nums">{{ c.offsets.length ? `dernière note : ${Math.round(c.offsets.at(-1))} ms après le clic` : 'en attente de ta première note' }}</p>
      </template>
      <template v-else-if="c.result">
        <template v-if="c.result.ms !== null">
          <h3 class="mt-1 text-xl font-black text-white">Calage mesuré : {{ c.result.ms }} ms</h3>
          <p class="mt-1 text-sm text-neutral-400">
            Régularité ±{{ c.result.spread }} ms —
            <span :class="c.result.spread <= 15 ? 'text-emerald-300' : c.result.spread <= 35 ? 'text-amber-300' : 'text-rose-300'">{{ c.result.spread <= 15 ? 'mesure fiable' : c.result.spread <= 35 ? 'mesure correcte' : 'mesure peu fiable, recommence' }}</span>.
            Actuellement : {{ s.latency }} ms.
          </p>
        </template>
        <template v-else>
          <h3 class="mt-1 text-xl font-black text-white">Pas assez de notes entendues</h3>
          <p class="mt-1 text-sm text-neutral-400">Vérifie que l'écoute de la guitare est active et que le niveau d'entrée monte quand tu joues.</p>
        </template>
        <div class="mt-5 flex gap-2">
          <button v-if="c.result.ms !== null" class="primary" @click="s.applyCalibration">Appliquer {{ c.result.ms }} ms</button>
          <button class="secondary" @click="s.startCalibration">Recommencer</button>
          <button class="secondary ml-auto" @click="s.closeCalibration">Fermer</button>
        </div>
      </template>
      <template v-else>
        <h3 class="mt-1 text-xl font-black text-white">Mesure le délai de ton installation</h3>
        <p class="mt-2 text-sm text-neutral-400">Entre le moment où tu joues et celui où l'app reconnaît la note, il s'écoule un délai (interface audio, micro, détection). Le connaître place tes notes exactement là où tu les joues.</p>
        <p class="mt-2 text-sm text-neutral-400">Après une mesure de décompte, joue <b class="text-neutral-200">8 notes, une sur chaque clic</b>.</p>
        <div class="mt-5 flex gap-2">
          <button class="primary" @click="s.startCalibration">Commencer</button>
          <button class="secondary ml-auto" @click="s.closeCalibration">Annuler</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@reference "../../style.css";

.dialog {
  @apply w-full max-w-md rounded-2xl p-6 shadow-2xl ring-1 ring-white/10;
  background: #1a1817;
}
.dot {
  @apply size-4 rounded-full bg-neutral-800 ring-1 ring-white/10 transition;
}
.dot.on {
  @apply bg-copper-500 ring-copper-300 shadow-[0_0_10px] shadow-copper-500/60;
}
.primary {
  @apply h-9 rounded-xl bg-copper-500 px-4 text-sm font-bold text-white hover:bg-copper-400;
}
.secondary {
  @apply h-9 rounded-xl px-4 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 hover:bg-white/5;
}
</style>
