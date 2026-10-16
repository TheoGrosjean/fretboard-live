<script setup>
// Potard d'ampli : glisser vers le haut / le bas, molette, flèches du clavier ; double-clic = valeur par défaut
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  defaultValue: { type: Number, default: 5 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  step: { type: Number, default: 0.1 },
  size: { type: Number, default: 76 },
})
const model = defineModel({ type: Number, required: true })

const SWEEP = 300 // course du potard en degrés
const clamp = (v) => Math.min(props.max, Math.max(props.min, Math.round(v / props.step) * props.step))
const ratio = computed(() => (model.value - props.min) / (props.max - props.min))
const angle = computed(() => -SWEEP / 2 + ratio.value * SWEEP)

// Graduations sérigraphiées autour du potard, de 0 à 10
const polar = (deg, r) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]
}
const ticks = Array.from({ length: 11 }, (_, i) => {
  const deg = -SWEEP / 2 + (i / 10) * SWEEP
  const [x1, y1] = polar(deg, 41)
  const [x2, y2] = polar(deg, i % 5 === 0 ? 47 : 45)
  const [tx, ty] = polar(deg, 55)
  return { x1, y1, x2, y2, tx, ty, n: i, major: i % 5 === 0 }
})

let startY = 0
let startValue = 0
function onPointerDown(e) {
  e.currentTarget.setPointerCapture(e.pointerId)
  startY = e.clientY
  startValue = model.value
}
function onPointerMove(e) {
  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
  const fine = e.shiftKey ? 0.25 : 1 // Maj : réglage fin
  model.value = clamp(startValue + ((startY - e.clientY) / 180) * (props.max - props.min) * fine)
}
function onWheel(e) {
  model.value = clamp(model.value - Math.sign(e.deltaY) * props.step * (e.shiftKey ? 1 : 2))
}
function onKey(e) {
  const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]
  if (!delta) return
  e.preventDefault()
  model.value = clamp(model.value + delta * props.step * (e.shiftKey ? 1 : 5))
}
</script>

<template>
  <div class="knob flex flex-col items-center select-none">
    <svg
      :width="size"
      :height="size"
      viewBox="-14 -14 128 128"
      class="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-black/50"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="model"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @wheel.prevent="onWheel"
      @keydown="onKey"
      @dblclick="model = defaultValue"
    >
      <defs>
        <radialGradient id="knob-skirt" cx="0.45" cy="0.35" r="0.75">
          <stop offset="0" stop-color="#3b3632" />
          <stop offset="1" stop-color="#0c0a09" />
        </radialGradient>
        <radialGradient id="knob-top" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stop-color="#fff7e0" />
          <stop offset="0.35" stop-color="#e9c98a" />
          <stop offset="0.75" stop-color="#a77b38" />
          <stop offset="1" stop-color="#6b4a1c" />
        </radialGradient>
        <filter id="knob-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#000" flood-opacity="0.55" />
        </filter>
      </defs>
      <!-- Sérigraphie -->
      <g class="silk">
        <line v-for="t in ticks" :key="'t' + t.n" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" :stroke-width="t.major ? 2.2 : 1.4" />
        <text v-for="t in ticks.filter((t) => t.major)" :key="'n' + t.n" :x="t.tx" :y="t.ty + 5" text-anchor="middle" font-size="14" font-weight="800">{{ t.n }}</text>
      </g>
      <!-- Jupe noire crantée + capuchon doré, qui tournent ensemble -->
      <g :transform="`rotate(${angle} 50 50)`" filter="url(#knob-shadow)">
        <circle cx="50" cy="50" r="36" fill="url(#knob-skirt)" />
        <circle cx="50" cy="50" r="36" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="2.2 2.6" opacity="0.7" />
        <circle cx="50" cy="50" r="22" fill="url(#knob-top)" stroke="#3a2a12" stroke-width="1" />
        <circle cx="50" cy="50" r="15" fill="none" stroke="#fff3" stroke-width="0.8" />
        <line x1="50" y1="16" x2="50" y2="31" stroke="#f5f5f4" stroke-width="4" stroke-linecap="round" />
      </g>
    </svg>
    <div class="label -mt-1 text-[10px] font-black tracking-[0.1em] uppercase sm:text-[11px] sm:tracking-[0.22em]">{{ label }}</div>
  </div>
</template>

<style scoped>
/* Couleur de sérigraphie héritée de la façade (variable --silk) */
.silk line {
  stroke: var(--silk, #1c1917);
}
.silk text {
  fill: var(--silk, #1c1917);
  opacity: 0.85;
}
.label {
  color: var(--silk, #1c1917);
}
</style>
