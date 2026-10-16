<script setup>
import { computed } from 'vue'
import { noteName } from '../lib/music'

const props = defineProps({
  state: { type: Object, required: true }, // voir useCombo
  announcement: { type: Object, default: null },
  floater: { type: Object, default: null },
  lastNoteAt: { type: Number, default: 0 },
  decayMs: { type: Number, required: true },
  active: { type: Boolean, default: true }, // une gamme est sélectionnée
  items: { type: Array, required: true }, // historique [{ id, midi, string, fret, info, outside }]
  notation: { type: String, default: 'en' },
})
defineEmits(['reset', 'clear'])

// Couleurs par multiplicateur (×1 → ×4)
const TIERS = [
  { bar: 'bg-copper-400', badge: 'bg-neutral-800 text-neutral-300' },
  { bar: 'bg-orange-500', badge: 'bg-copper-500 text-white' },
  { bar: 'bg-red-500', badge: 'bg-orange-600 text-white' },
  { bar: 'fire', badge: 'fire text-white' },
]
const tier = computed(() => TIERS[props.state.mult - 1])

const TONES = {
  copper: 'text-copper-300',
  fire: 'fire-text',
  warn: 'text-amber-300',
  danger: 'text-rose-400',
}
</script>

<template>
  <section class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Combo</h2>
      <div class="flex gap-3 text-xs text-neutral-500">
        <button class="hover:text-neutral-200" @click="$emit('reset')">Nouvelle partie</button>
        <button v-if="items.length" class="hover:text-neutral-200" @click="$emit('clear')">Effacer l'historique</button>
      </div>
    </div>

    <template v-if="active">
      <!-- Compteur, multiplicateur, score -->
      <div class="flex items-end gap-4">
        <div class="leading-none">
          <div class="text-7xl font-black tabular-nums transition-colors" :class="state.combo ? 'text-white' : 'text-neutral-700'">{{ state.combo }}</div>
          <div class="mt-1 text-[11px] tracking-widest text-neutral-500 uppercase">combo</div>
        </div>
        <div class="mb-6 rounded-xl px-3 py-1.5 text-2xl font-black transition-colors" :class="tier.badge">×{{ state.mult }}</div>
        <div v-if="state.misses" class="mb-6 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">1 erreur tolérée</div>

        <div class="relative ml-auto text-right">
          <div class="text-4xl font-black text-white tabular-nums">{{ state.score.toLocaleString('fr-FR') }}</div>
          <div class="text-[11px] text-neutral-500 tabular-nums">record {{ state.record.score.toLocaleString('fr-FR') }}</div>
          <span v-if="floater" :key="floater.id" class="floater absolute -top-4 right-0 text-sm font-bold text-copper-300">{{ floater.text }}</span>
        </div>
      </div>

      <!-- Barre de combo vers le palier suivant + jauge de temps -->
      <div class="mt-4 h-4 overflow-hidden rounded-full bg-neutral-800">
        <div class="h-full rounded-full transition-[width] duration-200" :class="tier.bar" :style="{ width: Math.max(state.progress, state.combo ? 0.03 : 0) * 100 + '%' }" />
      </div>
      <div class="mt-1 h-0.5 overflow-hidden rounded-full">
        <div v-if="state.combo" :key="lastNoteAt" class="drain h-full bg-neutral-500" :style="{ animationDuration: decayMs + 'ms' }" />
      </div>

      <!-- Stats de session -->
      <div class="mt-3 grid shrink-0 grid-cols-4 gap-2 text-center">
        <div v-for="s in [
          { label: 'Précision', value: state.accuracy === null ? '—' : state.accuracy + ' %' },
          { label: 'Notes', value: state.notes },
          { label: 'Meilleur combo', value: state.bestCombo },
          { label: 'Record combo', value: state.record.combo },
        ]" :key="s.label" class="rounded-lg bg-neutral-800/60 px-2 py-1.5">
          <div class="text-sm font-bold text-neutral-100 tabular-nums">{{ s.value }}</div>
          <div class="text-[10px] text-neutral-500">{{ s.label }}</div>
        </div>
      </div>
    </template>
    <p v-else class="py-4 text-sm text-neutral-500">Choisis une gamme ou un arpège pour lancer le combo.</p>

    <!-- Flux des notes jouées -->
    <TransitionGroup v-if="items.length" tag="ul" name="hist" class="mt-3 flex min-h-0 flex-wrap content-start gap-1.5 overflow-y-auto">
      <li
        v-for="(n, i) in items"
        :key="n.id"
        class="flex min-w-12 flex-col items-center rounded-md px-2 py-1 ring-1"
        :class="[
          n.glide ? 'bg-transparent ring-stone-700 border-dashed' : n.outside ? 'bg-rose-500/10 ring-rose-500/40' : n.info?.isRoot ? 'bg-copper-500/15 ring-copper-400/50' : 'bg-stone-800/60 ring-stone-600/50',
          i === 0 ? '' : 'opacity-60',
        ]"
      >
        <span class="text-sm font-bold" :class="n.glide ? 'text-stone-500' : n.outside ? 'text-rose-300' : n.info?.isRoot ? 'text-copper-300' : 'text-stone-100'">
          {{ noteName(n.midi, notation, true) }}
        </span>
        <span class="text-[10px] text-neutral-500 tabular-nums">
          <template v-if="n.glide">slide · </template><template v-else-if="n.info">{{ n.info.degree }} · </template>c{{ n.string + 1 }} f{{ n.fret }}
        </span>
      </li>
    </TransitionGroup>
    <p v-else-if="active" class="mt-3 text-sm text-neutral-600">Joue des notes de la gamme pour faire monter le combo.</p>

    <!-- Annonces -->
    <div v-if="announcement" :key="announcement.id" class="announce pointer-events-none absolute inset-x-0 top-1/3 text-center text-4xl font-black tracking-tight" :class="TONES[announcement.tone]">
      {{ announcement.text }}
    </div>
  </section>
</template>

<style scoped>
.fire {
  background: linear-gradient(90deg, #e2683a, #f97316, #ef4444, #f97316, #e2683a);
  background-size: 200% 100%;
  animation: fire 1.2s linear infinite;
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.6);
}
.fire-text {
  background: linear-gradient(90deg, #f0956a, #f97316, #ef4444);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
@keyframes fire {
  to {
    background-position: -200% 0;
  }
}

.drain {
  width: 100%;
  animation-name: drain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes drain {
  to {
    width: 0;
  }
}

.floater {
  animation: float-up 0.7s ease-out forwards;
}
@keyframes float-up {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-14px);
  }
}

.announce {
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
  animation: pop 1.6s ease-out forwards;
}
@keyframes pop {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  15% {
    opacity: 1;
    transform: scale(1.1);
  }
  25% {
    transform: scale(1);
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-10px);
  }
}

.hist-enter-from {
  opacity: 0;
  transform: translateX(-12px) scale(0.9);
}
.hist-enter-active,
.hist-move {
  transition: all 0.2s ease;
}
.hist-leave-active {
  display: none;
}
</style>
