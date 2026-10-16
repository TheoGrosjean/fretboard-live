<script setup>
// Écran de chargement « corde pincée » : la corde est tirée, relâchée, vibre en s'amortissant
// (somme d'harmoniques d'une corde pincée), et la vibration fait apparaître le logo.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({ freezeAt: { type: Number, default: null } }) // ms : fige l'animation (aperçus)
const emit = defineEmits(['done'])

const W = 800
const H = 400
const X0 = 40 // extrémités de la corde
const X1 = 760
const PLUCK = 0.32 // point de pincement (fraction de la longueur)
const AMP = 70 // déplacement maximal (px)

const PULL_MS = 380
const VIBRATE_MS = 1500
const LEAVE_AT = 2000
const DONE_AT = 2450

const path = ref(`M ${X0} ${H / 2} L ${X1} ${H / 2}`)
const glow = ref(0)
const leaving = ref(false)
let raf = 0
let start = 0
let timers = []

// Coefficients de Fourier d'une corde pincée en forme de triangle
const HARMONICS = Array.from({ length: 6 }, (_, i) => {
  const n = i + 1
  return { n, b: (2 / (n * n * Math.PI ** 2 * PLUCK * (1 - PLUCK))) * Math.sin(n * Math.PI * PLUCK) }
})

function shape(t) {
  const points = []
  for (let i = 0; i <= 90; i++) {
    const u = i / 90
    let y
    if (t < PULL_MS) {
      // Tirée : triangle qui se creuse
      const pull = 1 - (1 - t / PULL_MS) ** 3
      y = AMP * pull * (u < PLUCK ? u / PLUCK : (1 - u) / (1 - PLUCK))
    } else {
      const s = (t - PULL_MS) / 1000
      // Vibration : chaque harmonique oscille à n × f1 et s'amortit d'autant plus vite qu'elle est aiguë
      y = HARMONICS.reduce((sum, { n, b }) => sum + b * Math.sin(n * Math.PI * u) * Math.cos(2 * Math.PI * 7 * n * s) * Math.exp((-s * (1.8 + n)) / 0.9), 0) * AMP
    }
    points.push(`${(X0 + u * (X1 - X0)).toFixed(1)} ${(H / 2 - y).toFixed(1)}`)
  }
  return `M ${points.join(' L ')}`
}

function frame(now) {
  const t = now - start
  path.value = shape(t)
  glow.value = t < PULL_MS ? t / PULL_MS : Math.max(0, 1 - (t - PULL_MS) / VIBRATE_MS)
  if (t < PULL_MS + VIBRATE_MS) raf = requestAnimationFrame(frame)
  else path.value = `M ${X0} ${H / 2} L ${X1} ${H / 2}`
}

onMounted(() => {
  if (props.freezeAt !== null) {
    path.value = shape(props.freezeAt)
    glow.value = props.freezeAt < PULL_MS ? props.freezeAt / PULL_MS : Math.max(0, 1 - (props.freezeAt - PULL_MS) / VIBRATE_MS)
    return
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    timers = [setTimeout(() => (leaving.value = true), 600), setTimeout(() => emit('done'), 1000)]
    return
  }
  start = performance.now()
  raf = requestAnimationFrame(frame)
  timers = [setTimeout(() => (leaving.value = true), LEAVE_AT), setTimeout(() => emit('done'), DONE_AT)]
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  timers.forEach(clearTimeout)
})
</script>

<template>
  <div class="loader absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-anthracite" :class="{ leaving }">
    <div class="logo mb-2 text-4xl font-black tracking-tight text-white sm:text-5xl">Fretboard <span class="text-copper-400">Live</span></div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="w-full max-w-3xl" aria-hidden="true">
      <defs>
        <linearGradient id="ls-string" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f0d9ac" />
          <stop offset="0.5" stop-color="#c9a571" />
          <stop offset="1" stop-color="#7d5f38" />
        </linearGradient>
        <radialGradient id="ls-glow">
          <stop offset="0" stop-color="#f0956a" stop-opacity="0.55" />
          <stop offset="1" stop-color="#f0956a" stop-opacity="0" />
        </radialGradient>
      </defs>
      <!-- Halo cuivre au point de pincement -->
      <ellipse :cx="X0 + PLUCK * (X1 - X0)" :cy="H / 2" rx="220" ry="120" fill="url(#ls-glow)" :opacity="glow" />
      <!-- Sillet et chevalet -->
      <rect :x="X0 - 6" :y="H / 2 - 18" width="6" height="36" rx="2" fill="#e9e1cc" />
      <rect :x="X1" :y="H / 2 - 18" width="6" height="36" rx="2" fill="#c5c9cf" />
      <path :d="path" fill="none" stroke="url(#ls-string)" stroke-width="3.5" stroke-linecap="round" />
    </svg>
  </div>
</template>

<style scoped>
.logo {
  opacity: 0;
  letter-spacing: 0.3em;
  filter: blur(6px);
  animation: logo-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) 0.55s forwards;
}
@keyframes logo-in {
  to {
    opacity: 1;
    letter-spacing: -0.02em;
    filter: blur(0);
  }
}
.loader {
  transition:
    opacity 0.45s ease,
    transform 0.45s ease;
}
.loader.leaving {
  opacity: 0;
  transform: scale(1.03);
}
@media (prefers-reduced-motion: reduce) {
  .logo {
    animation-duration: 0.01s;
    animation-delay: 0s;
  }
}
</style>
