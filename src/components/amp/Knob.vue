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
        <!-- Lumière fixe venant d'en haut à gauche : seuls le crantage et le repère tournent -->
        <linearGradient id="knob-side" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stop-color="#5a524b" />
          <stop offset="0.45" stop-color="#1f1b18" />
          <stop offset="1" stop-color="#030202" />
        </linearGradient>
        <linearGradient id="knob-bevel" x1="0.25" y1="0" x2="0.75" y2="1">
          <stop offset="0" stop-color="#8a8178" />
          <stop offset="0.5" stop-color="#2a2522" />
          <stop offset="1" stop-color="#000" />
        </linearGradient>
        <radialGradient id="knob-cap" cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stop-color="#fffaf0" />
          <stop offset="0.18" stop-color="#f3dca6" />
          <stop offset="0.55" stop-color="#c9a05a" />
          <stop offset="0.85" stop-color="#8a6326" />
          <stop offset="1" stop-color="#5c3f14" />
        </radialGradient>
        <linearGradient id="knob-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.55" />
          <stop offset="0.4" stop-color="#fff" stop-opacity="0" />
          <stop offset="0.8" stop-color="#fff" stop-opacity="0" />
          <stop offset="1" stop-color="#ffe3a8" stop-opacity="0.45" />
        </linearGradient>
        <filter id="knob-blur3" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3" /></filter>
        <filter id="knob-blur1" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.2" /></filter>
      </defs>
      <!-- Sérigraphie -->
      <g class="silk">
        <line v-for="t in ticks" :key="'t' + t.n" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" :stroke-width="t.major ? 2.2 : 1.4" />
        <text v-for="t in ticks.filter((t) => t.major)" :key="'n' + t.n" :x="t.tx" :y="t.ty + 5" text-anchor="middle" font-size="14" font-weight="800">{{ t.n }}</text>
      </g>
      <!-- Ombres portées sur la façade : large et diffuse, puis contact serré -->
      <ellipse cx="57" cy="62" rx="37" ry="36" fill="#000" opacity="0.6" filter="url(#knob-blur3)" />
      <circle cx="52" cy="54" r="36.5" fill="#000" opacity="0.7" filter="url(#knob-blur1)" />
      <!-- Tranche de la jupe (cylindre éclairé d'en haut à gauche) -->
      <circle cx="50" cy="50" r="36" fill="url(#knob-side)" />
      <!-- Crantage : tourne avec le potard -->
      <g :transform="`rotate(${angle} 50 50)`">
        <circle cx="50" cy="50" r="34" fill="none" stroke="#000" stroke-width="4" stroke-dasharray="1.6 1.96" opacity="0.65" />
        <circle cx="50" cy="50" r="34" fill="none" stroke="#9a9088" stroke-width="4" stroke-dasharray="0.6 2.96" stroke-dashoffset="-1.8" opacity="0.35" />
      </g>
      <circle cx="50" cy="50" r="36" fill="none" stroke="url(#knob-rim)" stroke-width="1.2" />
      <!-- Biseau entre la jupe et le capuchon -->
      <circle cx="50" cy="50" r="30" fill="url(#knob-bevel)" />
      <circle cx="50" cy="50" r="27.5" fill="#0c0a09" />
      <!-- Repère blanc sur la jupe : tourne avec le potard -->
      <g :transform="`rotate(${angle} 50 50)`">
        <line x1="50.8" y1="15.5" x2="50.8" y2="27" stroke="#000" stroke-width="4" stroke-linecap="round" opacity="0.5" />
        <line x1="50" y1="15" x2="50" y2="26.5" stroke="#f5f5f4" stroke-width="3.6" stroke-linecap="round" />
      </g>
      <!-- Capuchon doré bombé, cerclage brossé et reflet fixes -->
      <circle cx="50" cy="50" r="26" fill="url(#knob-cap)" />
      <g fill="none" stroke-width="0.6">
        <circle cx="50" cy="50" r="22" stroke="#fff" opacity="0.18" />
        <circle cx="50" cy="50" r="17.5" stroke="#5c3f14" opacity="0.25" />
        <circle cx="50" cy="50" r="13" stroke="#fff" opacity="0.15" />
        <circle cx="50" cy="50" r="8.5" stroke="#5c3f14" opacity="0.2" />
      </g>
      <circle cx="50" cy="50" r="25.5" fill="none" stroke="url(#knob-rim)" stroke-width="1.4" />
      <circle cx="50" cy="50" r="26" fill="none" stroke="#3a2a10" stroke-width="0.8" opacity="0.8" />
      <ellipse cx="41" cy="38" rx="11" ry="6.5" transform="rotate(-35 41 38)" fill="#fff" opacity="0.55" filter="url(#knob-blur1)" />
      <!-- Encoche gravée sur le capuchon : tourne avec le potard -->
      <g :transform="`rotate(${angle} 50 50)`">
        <line x1="50" y1="26.5" x2="50" y2="36" stroke="#3a2608" stroke-width="2" stroke-linecap="round" opacity="0.75" />
        <line x1="50.9" y1="26.8" x2="50.9" y2="36" stroke="#fff4d6" stroke-width="0.8" stroke-linecap="round" opacity="0.6" />
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
