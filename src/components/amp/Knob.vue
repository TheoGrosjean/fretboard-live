<script setup>
// Potard d'ampli : glisser vers le haut / le bas, molette, flèches du clavier ; double-clic = valeur par défaut
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  defaultValue: { type: Number, default: 5 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  step: { type: Number, default: 0.1 },
  size: { type: Number, default: 72 },
})
const model = defineModel({ type: Number, required: true })

const SWEEP = 270 // course du potard en degrés
const clamp = (v) => Math.min(props.max, Math.max(props.min, Math.round(v / props.step) * props.step))
const ratio = computed(() => (model.value - props.min) / (props.max - props.min))
const angle = computed(() => -SWEEP / 2 + ratio.value * SWEEP)

// Arc de valeur autour du potard
const R = 44
const polar = (deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [50 + R * Math.cos(a), 50 + R * Math.sin(a)]
}
const arc = (from, to) => {
  const [x1, y1] = polar(from)
  const [x2, y2] = polar(to)
  return `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}
const track = arc(-SWEEP / 2, SWEEP / 2)
const valueArc = computed(() => (ratio.value > 0.001 ? arc(-SWEEP / 2, angle.value) : ''))
const ticks = Array.from({ length: 11 }, (_, i) => {
  const [x1, y1] = polar(-SWEEP / 2 + (i / 10) * SWEEP)
  return { x1, y1, x2: 50 + (x1 - 50) * 1.13, y2: 50 + (y1 - 50) * 1.13 }
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
  <div class="flex flex-col items-center gap-1.5 select-none">
    <svg
      :width="size"
      :height="size"
      viewBox="-6 -6 112 112"
      class="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-copper-400"
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
        <radialGradient id="knob-cap" cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#4a4541" />
          <stop offset="0.6" stop-color="#1f1c1a" />
          <stop offset="1" stop-color="#0e0c0b" />
        </radialGradient>
      </defs>
      <line v-for="(t, i) in ticks" :key="i" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" stroke="#57534e" stroke-width="1.5" />
      <path :d="track" fill="none" stroke="#292524" stroke-width="5" stroke-linecap="round" />
      <path v-if="valueArc" :d="valueArc" fill="none" style="stroke: var(--color-copper-400)" stroke-width="5" stroke-linecap="round" />
      <!-- Jupe crantée + capuchon -->
      <circle cx="50" cy="50" r="35" fill="#0b0a09" stroke="#3f3a36" stroke-width="2" stroke-dasharray="2 2.4" />
      <circle cx="50" cy="50" r="30" fill="url(#knob-cap)" stroke="#000" stroke-width="1" />
      <g :transform="`rotate(${angle} 50 50)`">
        <line x1="50" y1="24" x2="50" y2="38" stroke="#f5f5f4" stroke-width="3.5" stroke-linecap="round" />
      </g>
    </svg>
    <div class="text-[11px] font-bold tracking-[0.2em] text-neutral-300 uppercase">{{ label }}</div>
    <div class="-mt-1 text-[11px] text-neutral-500 tabular-nums">{{ model.toFixed(1) }}</div>
  </div>
</template>
