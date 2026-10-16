<script setup>
import { computed, ref, watch } from 'vue'
import { noteName, pitchClass } from '../lib/music'
import { DEFAULT_PALETTE, alternateMark, findPalette, playedMark, scaleMark } from '../lib/noteStyles'
import NoteMark from './NoteMark.vue'

const props = defineProps({
  tuning: { type: Array, required: true },
  frets: { type: Number, default: 22 },
  overlay: { type: Map, required: true },
  notation: { type: String, default: 'en' },
  labelMode: { type: String, default: 'note' }, // 'note' | 'degree'
  played: { type: Object, default: null }, // { midi, string, fret }
  alternates: { type: Array, default: () => [] },
  anchor: { type: Object, default: null },
  palette: { type: String, default: DEFAULT_PALETTE }, // voir lib/noteStyles.js
  heat: { type: Number, default: 0 }, // 0–3 : intensité du halo selon le multiplicateur de combo
  brokeAt: { type: Number, default: 0 }, // change quand le combo casse -> secousse
})
const emit = defineEmits(['play'])

const WIDTH = 1500
const NUT_X = 104
const END_X = WIDTH - 20
const TOP = 46
const SPACING = 54
const NOTE_SIZE = 40 // largeur des notes
const EDGE = 26 // débord du bois au-delà des cordes extrêmes

const stringCount = computed(() => props.tuning.length)
const neckBottom = computed(() => TOP + (stringCount.value - 1) * SPACING)
const woodTop = TOP - EDGE
const woodHeight = computed(() => neckBottom.value - TOP + EDGE * 2)
const height = computed(() => neckBottom.value + EDGE + 40)

// Mélange entre l'espacement réel des frettes et un espacement linéaire,
// pour garder des cases lisibles dans les aigus.
function fretX(f) {
  const t = f / props.frets
  const real = (1 - 2 ** (-f / 12)) / (1 - 2 ** (-props.frets / 12))
  return NUT_X + (END_X - NUT_X) * (real * 0.55 + t * 0.45)
}
const noteX = (f) => (f === 0 ? NUT_X - 38 : (fretX(f - 1) + fretX(f)) / 2)
const stringY = (s) => TOP + s * SPACING

const fretLines = computed(() => Array.from({ length: props.frets }, (_, i) => fretX(i + 1)))
const inlays = computed(() =>
  [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].filter((f) => f <= props.frets).map((f) => ({ fret: f, double: f % 12 === 0 })),
)

const cells = computed(() => {
  const out = []
  props.tuning.forEach((open, string) => {
    for (let fret = 0; fret <= props.frets; fret++) {
      const midi = open + fret
      const info = props.overlay.get(pitchClass(midi))
      out.push({ key: `${string}-${fret}`, string, fret, midi, info, x: noteX(fret), y: stringY(string) })
    }
  })
  return out
})

const playedInfo = computed(() => (props.played ? props.overlay.get(pitchClass(props.played.midi)) : null))
const playedOutside = computed(() => props.played && props.overlay.size > 0 && !playedInfo.value)

function label(midi, info) {
  if (props.labelMode === 'degree' && info) return info.degree
  return noteName(midi, props.notation)
}

const colors = computed(() => findPalette(props.palette))

// Halo autour du manche selon le multiplicateur (classes littérales pour Tailwind)
const GLOW = [
  'shadow-2xl shadow-black/60',
  'shadow-[0_0_28px_-6px] shadow-copper-500/40',
  'shadow-[0_0_40px_-6px] shadow-orange-500/55',
  'fire-glow',
]
const shaking = ref(false)
let shakeTimer = 0
watch(
  () => props.brokeAt,
  () => {
    shaking.value = true
    clearTimeout(shakeTimer)
    shakeTimer = setTimeout(() => (shaking.value = false), 450)
  },
)

const isPlayed = (c) => props.played && props.played.string === c.string && props.played.fret === c.fret
const isAlternate = (c) => props.alternates.some((a) => a.string === c.string && a.fret === c.fret)

// Zone de la main (≈ 4 cases autour de la position estimée)
const handZone = computed(() => {
  if (!props.anchor) return null
  const center = Math.round(props.anchor.fret)
  const from = Math.max(0, center - 2)
  const to = Math.min(props.frets, from + 4)
  const x1 = from === 0 ? NUT_X : fretX(from)
  return { x: x1, w: fretX(to) - x1 }
})

const stringWidth = (s) => 1.2 + (s / Math.max(1, stringCount.value - 1)) * 2.6
const isWound = (s) => s >= 3
</script>

<template>
  <div class="overflow-x-auto rounded-2xl bg-neutral-950 p-4 ring-1 ring-white/5 transition-shadow duration-500" :class="[GLOW[heat], { shake: shaking }]">
    <svg :viewBox="`0 0 ${WIDTH} ${height}`" class="w-full min-w-275 select-none" role="img" aria-label="Manche de guitare">
      <defs>
        <!-- Ébène : presque noir, légèrement chaud -->
        <linearGradient id="ebony" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1d1915" />
          <stop offset="0.5" stop-color="#14110e" />
          <stop offset="1" stop-color="#0d0b09" />
        </linearGradient>
        <!-- Veinage du bois, étiré dans le sens du manche -->
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.22" numOctaves="3" seed="7" />
          <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.27  0 0 0 0.16 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <!-- Frettes en maillechort -->
        <linearGradient id="fret" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#6d7178" />
          <stop offset="0.45" stop-color="#f1f3f5" />
          <stop offset="1" stop-color="#7d8188" />
        </linearGradient>
        <!-- Sillet en os -->
        <linearGradient id="nut" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#cfc6b0" />
          <stop offset="0.5" stop-color="#f6f0e0" />
          <stop offset="1" stop-color="#bdb39c" />
        </linearGradient>
        <!-- Incrustations nacrées -->
        <radialGradient id="pearl" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.35" stop-color="#e3eef0" />
          <stop offset="0.6" stop-color="#e9dcef" />
          <stop offset="0.8" stop-color="#d6e6dc" />
          <stop offset="1" stop-color="#a9b4b8" />
        </radialGradient>
        <linearGradient id="wound" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f0d9ac" />
          <stop offset="0.5" stop-color="#c9a571" />
          <stop offset="1" stop-color="#7d5f38" />
        </linearGradient>
        <linearGradient id="plain" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="1" stop-color="#9aa0a8" />
        </linearGradient>
        <!-- Ombre plus marquée pour la note jouée -->
        <filter id="lift" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.75" />
        </filter>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.6" />
        </filter>
      </defs>

      <!-- Touche en ébène -->
      <rect :x="NUT_X" :y="woodTop" :width="END_X - NUT_X" :height="woodHeight" fill="url(#ebony)" />
      <rect :x="NUT_X" :y="woodTop" :width="END_X - NUT_X" :height="woodHeight" fill="#fff" filter="url(#grain)" />
      <!-- Filets (binding) crème sur les bords -->
      <rect :x="NUT_X" :y="woodTop - 4" :width="END_X - NUT_X" height="4" fill="#e9e1cc" />
      <rect :x="NUT_X" :y="woodTop + woodHeight" :width="END_X - NUT_X" height="4" fill="#cfc5ad" />

      <!-- Zone estimée de la main -->
      <rect
        v-if="handZone"
        :x="handZone.x"
        :y="woodTop"
        :width="handZone.w"
        :height="woodHeight"
        class="fill-white/6 transition-all duration-300"
      />

      <!-- Incrustations -->
      <g v-for="m in inlays" :key="m.fret">
        <template v-if="m.double">
          <circle :cx="noteX(m.fret)" :cy="TOP + SPACING * 1.5" r="8" fill="url(#pearl)" />
          <circle :cx="noteX(m.fret)" :cy="neckBottom - SPACING * 1.5" r="8" fill="url(#pearl)" />
        </template>
        <circle v-else :cx="noteX(m.fret)" :cy="(TOP + neckBottom) / 2" r="8" fill="url(#pearl)" />
      </g>

      <!-- Sillet et frettes -->
      <rect :x="NUT_X - 8" :y="woodTop - 4" width="10" :height="woodHeight + 8" fill="url(#nut)" rx="2" />
      <rect v-for="(x, i) in fretLines" :key="i" :x="x - 2" :y="woodTop" width="4" :height="woodHeight" fill="url(#fret)" />

      <!-- Cordes -->
      <g filter="url(#shadow)">
        <line
          v-for="(open, s) in tuning"
          :key="'s' + s"
          :x1="NUT_X - 62"
          :x2="END_X"
          :y1="stringY(s)"
          :y2="stringY(s)"
          :stroke="isWound(s) ? 'url(#wound)' : 'url(#plain)'"
          :stroke-width="stringWidth(s)"
        />
      </g>

      <!-- Nom des cordes à vide -->
      <text
        v-for="(open, s) in tuning"
        :key="'o' + s"
        x="12"
        :y="stringY(s) + 5"
        class="fill-neutral-400 text-[14px] font-bold"
      >
        {{ noteName(open, notation) }}
      </text>

      <!-- Numéros de case -->
      <text
        v-for="f in frets"
        :key="'n' + f"
        :x="noteX(f)"
        :y="neckBottom + EDGE + 28"
        text-anchor="middle"
        class="text-[14px] tabular-nums"
        :class="inlays.some((m) => m.fret === f) ? 'fill-neutral-200 font-bold' : 'fill-neutral-600'"
      >
        {{ f }}
      </text>

      <!-- Notes -->
      <g v-for="c in cells" :key="c.key" class="note-cell cursor-pointer" @click="emit('play', { string: c.string, fret: c.fret, midi: c.midi })">
        <rect :x="c.x - NOTE_SIZE / 2 - 6" :y="c.y - SPACING / 2" :width="NOTE_SIZE + 12" :height="SPACING" fill="transparent" />

        <!-- Note jouée : pastille agrandie et remplie -->
        <NoteMark v-if="isPlayed(c)" :x="c.x" :y="c.y" :text="label(c.midi, c.info)" v-bind="playedMark(colors, { outside: playedOutside })" />

        <!-- Autres positions possibles de la note jouée -->
        <NoteMark v-else-if="isAlternate(c)" :x="c.x" :y="c.y" :text="label(c.midi, c.info)" v-bind="alternateMark(colors, { outside: playedOutside })" />

        <!-- Notes de la gamme / arpège -->
        <NoteMark v-else-if="c.info" class="mark" :x="c.x" :y="c.y" :text="label(c.midi, c.info)" v-bind="scaleMark(c.info, label(c.midi, c.info), colors)" />

        <!-- Survol -->
        <circle v-else :cx="c.x" :cy="c.y" :r="NOTE_SIZE / 2 - 3" class="fill-white/0 transition-colors hover:fill-white/15" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.fire-glow {
  animation: fire-glow 1.4s ease-in-out infinite;
}
@keyframes fire-glow {
  0%,
  100% {
    box-shadow: 0 0 40px -6px rgba(239, 68, 68, 0.55);
  }
  50% {
    box-shadow: 0 0 56px -2px rgba(249, 115, 22, 0.75);
  }
}
.shake {
  animation: shake 0.45s ease-in-out;
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-6px);
  }
  40% {
    transform: translateX(5px);
  }
  60% {
    transform: translateX(-3px);
  }
  80% {
    transform: translateX(2px);
  }
}
.mark {
  transition: opacity 0.15s;
}
.note-cell:hover .mark {
  opacity: 0.8;
}
</style>
