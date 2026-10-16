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
    <!-- Sensation de fin de phrase : chaque lettre est animée selon l'effet de la sensation -->
    <div
      v-if="announcement?.effect"
      :key="announcement.id"
      class="fx pointer-events-none absolute inset-x-0 top-[22%] text-center"
      :class="`fx-${announcement.effect}`"
    >
      <div class="word text-4xl font-black tracking-tight">
        <span v-for="(ch, i) in announcement.text" :key="i" class="ch" :style="{ '--i': i }">{{ ch === ' ' ? '\u00a0' : ch }}</span>
      </div>
      <div class="sub mt-1 text-[13px] font-medium text-neutral-400">{{ announcement.sub }}</div>
    </div>
    <!-- Autres annonces (paliers, combo perdu…) -->
    <div v-else-if="announcement" :key="announcement.id" class="announce pointer-events-none absolute inset-x-0 top-1/3 text-center text-4xl font-black tracking-tight" :class="TONES[announcement.tone]">
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

/* ---------- Sensations de fin de phrase ---------- */
.fx {
  padding: 18px 12px;
  /* Voile sombre derrière le texte pour qu'il reste lisible au-dessus du compteur */
  background: radial-gradient(ellipse 60% 70% at center, rgba(17, 17, 17, 0.95) 45%, rgba(17, 17, 17, 0) 100%);
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.85);
  animation: fx-life 2.6s ease forwards;
}
@keyframes fx-life {
  0% {
    opacity: 0;
  }
  6%,
  82% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.fx .ch {
  display: inline-block;
}
.fx .sub {
  opacity: 0;
  animation: sub-in 0.5s ease 0.35s forwards;
}
@keyframes sub-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 1 · Résolution : les lettres tombent et se posent, halo doré */
.fx-settle .word {
  color: #fde3c8;
  text-shadow:
    0 0 18px rgba(240, 149, 106, 0.7),
    0 4px 24px rgba(0, 0, 0, 0.85);
}
.fx-settle .ch {
  opacity: 0;
  animation: settle 0.7s cubic-bezier(0.2, 1.4, 0.4, 1) calc(var(--i) * 45ms) forwards;
}
@keyframes settle {
  from {
    opacity: 0;
    transform: translateY(-24px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* b2 · Inquiétant : glitch, aberration chromatique */
.fx-glitch .word {
  color: #e5e5e5;
  text-shadow:
    2px 0 rgba(239, 68, 68, 0.85),
    -2px 0 rgba(56, 189, 248, 0.85);
  animation: glitch 0.32s steps(2) infinite;
}
@keyframes glitch {
  0% {
    transform: translate(0);
    clip-path: inset(0 0 0 0);
  }
  25% {
    transform: translate(-3px, 1px);
    clip-path: inset(20% 0 40% 0);
  }
  50% {
    transform: translate(3px, -1px);
    clip-path: inset(0 0 0 0);
  }
  75% {
    transform: translate(-1px, 2px);
    clip-path: inset(55% 0 10% 0);
  }
}

/* 2 · Suspendu : les lettres flottent en vague, aériennes */
.fx-float .word {
  color: #e0ecff;
  letter-spacing: 0.12em;
  font-weight: 700;
}
.fx-float .ch {
  animation: float 1.6s ease-in-out calc(var(--i) * 90ms) infinite alternate;
}
@keyframes float {
  from {
    transform: translateY(6px);
    opacity: 0.6;
  }
  to {
    transform: translateY(-8px);
    opacity: 1;
  }
}

/* b3 · Mélancolique : bleu, les lettres s'affaissent une à une */
.fx-melancholy .word {
  color: #93c5fd;
}
.fx-melancholy .ch {
  animation: droop 2.2s ease-in calc(400ms + var(--i) * 90ms) forwards;
}
@keyframes droop {
  to {
    transform: translateY(14px) rotate(6deg);
    opacity: 0.35;
    filter: blur(1px);
  }
}

/* 3 · Lumineux : reflet qui balaie le texte */
.fx-shine .word {
  background: linear-gradient(100deg, #f5b48f 20%, #fffaf0 45%, #f5b48f 70%);
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 12px rgba(245, 180, 143, 0.6));
  animation: shine 1.4s ease-in-out infinite;
}
@keyframes shine {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}

/* 4 · En attente… : penché, tapé lettre par lettre */
.fx-lean .word {
  color: #e7e5e4;
  transform: skewX(-10deg);
}
.fx-lean .ch {
  opacity: 0;
  animation: type 0.01s linear calc(var(--i) * 80ms) forwards;
}
@keyframes type {
  to {
    opacity: 1;
  }
}

/* b5 · Grinçant : secousses et déformations */
.fx-grind .word {
  color: #fb923c;
  animation: grind 0.12s linear infinite;
}
@keyframes grind {
  0% {
    transform: translate(0) skewX(0);
  }
  25% {
    transform: translate(-2px, 1px) skewX(6deg);
  }
  50% {
    transform: translate(2px, -1px) skewX(-5deg);
  }
  75% {
    transform: translate(-1px, -1px) skewX(3deg);
  }
}

/* 5 · Puissant : impact massif */
.fx-punch .word {
  color: #fff;
  font-size: 3rem;
  -webkit-text-stroke: 1px #e2683a;
  animation: punch 0.45s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
@keyframes punch {
  from {
    transform: scale(2.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* b6 · Dramatique : rouge sombre, lent zoom, lettres qui s'écartent */
.fx-drama .word {
  color: #dc2626;
  text-shadow:
    0 0 30px rgba(127, 29, 29, 0.9),
    0 6px 30px rgba(0, 0, 0, 0.95);
  animation: drama 2.6s ease-out forwards;
}
@keyframes drama {
  from {
    transform: scale(0.85);
    letter-spacing: -0.05em;
  }
  to {
    transform: scale(1.1);
    letter-spacing: 0.15em;
  }
}

/* 6 · Nostalgique : sépia, italique à empattements, flou qui va et vient */
.fx-vintage .word {
  color: #e7c9a0;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-weight: 700;
  animation: vintage 2.6s ease-in-out forwards;
}
@keyframes vintage {
  0% {
    filter: blur(4px) sepia(1);
  }
  40% {
    filter: blur(0) sepia(0.6);
  }
  100% {
    filter: blur(1.5px) sepia(1);
  }
}

/* b7 · Bluesy : les lettres se balancent comme un pendule */
.fx-swing .word {
  color: #f0956a;
  font-style: italic;
}
.fx-swing .ch {
  transform-origin: 50% 0;
  animation: swing 0.9s ease-in-out calc(var(--i) * 60ms) infinite alternate;
}
@keyframes swing {
  from {
    transform: rotate(-9deg);
  }
  to {
    transform: rotate(9deg);
  }
}

/* 7 · Intrigue : les lettres frémissent puis sont attirées vers le haut, sans se résoudre */
.fx-intrigue .word {
  color: #c4b5fd;
  text-shadow:
    0 0 16px rgba(167, 139, 250, 0.7),
    0 4px 24px rgba(0, 0, 0, 0.85);
}
.fx-intrigue .ch {
  animation:
    tremble 0.09s linear infinite,
    pull-up 1.8s cubic-bezier(0.5, 0, 0.2, 1) calc(500ms + var(--i) * 70ms) forwards;
}
@keyframes tremble {
  50% {
    translate: 0 -1px;
  }
}
@keyframes pull-up {
  to {
    transform: translateY(-16px);
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fx .word,
  .fx .ch {
    animation: none !important;
    opacity: 1 !important;
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
