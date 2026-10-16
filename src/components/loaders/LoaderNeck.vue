<script setup>
// Écran de chargement « manche qui se dessine » : la touche apparaît, les frettes tombent une à une,
// les cordes se tendent, puis la box 1 de La pentatonique mineure s'allume en arpège ; on « entre » dans le manche.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({ freezeAt: { type: Number, default: null } }) // ms : fige l'animation (aperçus)
const emit = defineEmits(['done'])

const FRETS = 12
const NUT = 70
const END = 850
const TOP = 80
const SPACING = 28
const strings = Array.from({ length: 6 }, (_, s) => TOP + s * SPACING)
const bottom = strings.at(-1)

const fretX = (f) => NUT + ((END - NUT) * (1 - 2 ** (-f / 12))) / (1 - 2 ** (-FRETS / 12))
const noteX = (f) => (fretX(f - 1) + fretX(f)) / 2

// Box 1 de La penta mineure, de la corde grave à l'aiguë (corde 5 = Mi grave), toniques marquées
const NOTES = [
  [5, 5, true],
  [5, 8],
  [4, 5],
  [4, 7],
  [3, 5],
  [3, 7, true],
  [2, 5],
  [2, 7],
  [1, 5],
  [1, 8],
  [0, 5, true],
  [0, 8],
].map(([string, fret, root], i) => ({ x: noteX(fret), y: strings[string], root: Boolean(root), delay: 1.05 + i * 0.065 }))

const INLAYS = [3, 5, 7, 9]

const leaving = ref(false)
let timers = []
onMounted(() => {
  if (props.freezeAt !== null) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  timers = [setTimeout(() => (leaving.value = true), reduced ? 600 : 2350), setTimeout(() => emit('done'), reduced ? 1000 : 2850)]
})
onBeforeUnmount(() => timers.forEach(clearTimeout))
</script>

<template>
  <div class="loader absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-anthracite" :class="{ leaving }">
    <svg viewBox="0 0 920 300" class="neck w-full max-w-4xl" aria-hidden="true">
      <defs>
        <linearGradient id="ln-ebony" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1d1915" />
          <stop offset="1" stop-color="#0d0b09" />
        </linearGradient>
        <linearGradient id="ln-fret" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#6d7178" />
          <stop offset="0.5" stop-color="#f1f3f5" />
          <stop offset="1" stop-color="#7d8188" />
        </linearGradient>
      </defs>

      <!-- Touche -->
      <rect class="wood" :x="NUT" :y="TOP - 22" :width="END - NUT" :height="bottom - TOP + 44" rx="3" fill="url(#ln-ebony)" />
      <rect class="wood" :x="NUT" :y="TOP - 25" :width="END - NUT" height="3" fill="#e9e1cc" />
      <rect class="wood" :x="NUT" :y="bottom + 22" :width="END - NUT" height="3" fill="#cfc5ad" />

      <!-- Incrustations -->
      <circle v-for="(f, i) in INLAYS" :key="'i' + f" class="inlay" :style="{ animationDelay: 0.55 + i * 0.05 + 's' }" :cx="noteX(f)" :cy="(TOP + bottom) / 2" r="5" fill="#e3eef0" />
      <g class="inlay" style="animation-delay: 0.75s">
        <circle :cx="noteX(12)" :cy="TOP + SPACING * 1.5" r="5" fill="#e3eef0" />
        <circle :cx="noteX(12)" :cy="bottom - SPACING * 1.5" r="5" fill="#e3eef0" />
      </g>

      <!-- Sillet puis frettes qui tombent une à une -->
      <rect class="fret" style="animation-delay: 0.15s" :x="NUT - 7" :y="TOP - 25" width="8" :height="bottom - TOP + 50" rx="2" fill="#efe8d6" />
      <rect
        v-for="f in FRETS"
        :key="'f' + f"
        class="fret"
        :style="{ animationDelay: 0.18 + f * 0.035 + 's' }"
        :x="fretX(f) - 1.5"
        :y="TOP - 22"
        width="3"
        :height="bottom - TOP + 44"
        fill="url(#ln-fret)"
      />

      <!-- Cordes qui se tendent -->
      <line
        v-for="(y, s) in strings"
        :key="'s' + s"
        class="string"
        :style="{ animationDelay: 0.6 + s * 0.05 + 's' }"
        :x1="NUT - 40"
        :x2="END + 40"
        :y1="y"
        :y2="y"
        :stroke="s >= 3 ? '#c9a571' : '#d4d8dd'"
        :stroke-width="1 + s * 0.45"
        pathLength="1"
      />

      <!-- Arpège de notes cuivre -->
      <g v-for="(n, i) in NOTES" :key="'n' + i">
        <circle class="ping" :style="{ animationDelay: n.delay + 's' }" :cx="n.x" :cy="n.y" r="11" fill="none" stroke="#f0956a" stroke-width="2" />
        <circle
          class="note"
          :style="{ animationDelay: n.delay + 's' }"
          :cx="n.x"
          :cy="n.y"
          r="11"
          :fill="n.root ? '#e2683a' : '#1c1917'"
          :stroke="n.root ? '#f5b48f' : '#f0956a'"
          stroke-width="2"
        />
      </g>
    </svg>
    <div class="logo mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Fretboard <span class="text-copper-400">Live</span></div>
  </div>
</template>

<style scoped>
.wood {
  opacity: 0;
  animation: fade 0.35s ease forwards;
}
.inlay {
  opacity: 0;
  animation: fade 0.3s ease forwards;
}
.fret {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  transform: translateY(-30px) scaleY(0.4);
  animation: fret-drop 0.32s cubic-bezier(0.3, 1.4, 0.5, 1) forwards;
}
.string {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: draw 0.45s cubic-bezier(0.6, 0, 0.3, 1) forwards;
}
.note {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(0);
  animation: pop 0.35s cubic-bezier(0.3, 1.6, 0.5, 1) forwards;
}
.ping {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  animation: ping 0.6s ease-out forwards;
}
.logo {
  opacity: 0;
  transform: translateY(8px);
  animation: rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) 1.55s forwards;
}
@keyframes fade {
  to {
    opacity: 1;
  }
}
@keyframes fret-drop {
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes pop {
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes ping {
  0% {
    opacity: 0.9;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(2.4);
  }
}
@keyframes rise {
  to {
    opacity: 1;
    transform: none;
  }
}

/* Sortie : on « plonge » dans le manche */
.loader {
  transition:
    opacity 0.5s ease,
    transform 0.5s cubic-bezier(0.5, 0, 0.75, 0);
}
.loader.leaving {
  opacity: 0;
  transform: scale(1.12);
}

@media (prefers-reduced-motion: reduce) {
  .wood,
  .inlay,
  .fret,
  .string,
  .note,
  .logo {
    animation-duration: 0.01s;
    animation-delay: 0s !important;
  }
  .ping {
    display: none;
  }
}
</style>
