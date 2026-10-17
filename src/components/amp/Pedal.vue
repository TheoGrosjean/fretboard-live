<script setup>
// Pédale « stompbox » en boîtier moulé : peinture martelée, vis, mini-potards, LED et footswitch chromé
const props = defineProps({
  name: { type: String, required: true },
  sub: { type: String, default: '' },
  body: { type: String, required: true }, // couleur du boîtier (CSS)
  ink: { type: String, required: true }, // couleur de la sérigraphie
  type: { type: String, default: 'block' }, // style du nom : 'script' | 'block'
  knobs: { type: Array, default: () => [] }, // [{ label, value 0–10 }]
  active: { type: Boolean, default: false },
})

const KNOB_X = [26, 60, 94]
const knobAngle = (v) => -135 + (v / 10) * 270
const screws = [
  [9, 9],
  [111, 9],
  [9, 219],
  [111, 219],
]
</script>

<template>
  <svg class="pedal-svg" :class="{ active }" viewBox="-10 -4 140 244" :style="{ '--body': props.body, '--ink': props.ink }" aria-hidden="true">
    <defs>
      <linearGradient id="pd-bevel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.45" />
        <stop offset="0.06" stop-color="#fff" stop-opacity="0.08" />
        <stop offset="0.9" stop-color="#000" stop-opacity="0.1" />
        <stop offset="1" stop-color="#000" stop-opacity="0.5" />
      </linearGradient>
      <radialGradient id="pd-light" cx="0.3" cy="0.15" r="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.22" />
        <stop offset="0.5" stop-color="#fff" stop-opacity="0" />
        <stop offset="1" stop-color="#000" stop-opacity="0.3" />
      </radialGradient>
      <linearGradient id="pd-chrome" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f8fafc" />
        <stop offset="0.4" stop-color="#94a3b8" />
        <stop offset="0.65" stop-color="#e2e8f0" />
        <stop offset="1" stop-color="#334155" />
      </linearGradient>
      <radialGradient id="pd-dome" cx="0.38" cy="0.32" r="0.75">
        <stop offset="0" stop-color="#fff" />
        <stop offset="0.35" stop-color="#cbd5e1" />
        <stop offset="0.8" stop-color="#64748b" />
        <stop offset="1" stop-color="#1e293b" />
      </radialGradient>
      <radialGradient id="pd-knob" cx="0.4" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#4a4a4a" />
        <stop offset="0.6" stop-color="#151515" />
        <stop offset="1" stop-color="#000" />
      </radialGradient>
      <!-- Peinture martelée : bruit fin en relief -->
      <filter id="pd-hammer" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -1.4 1.05" result="a" />
        <feComposite in="a" in2="SourceGraphic" operator="in" />
      </filter>
      <filter id="pd-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" /></filter>
      <filter id="pd-blur-s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2" /></filter>
      <radialGradient id="pd-led-on" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#fff1f1" />
        <stop offset="0.35" stop-color="#ff4d4d" />
        <stop offset="1" stop-color="#9b0b0b" />
      </radialGradient>
    </defs>

    <!-- Ombre portée sur le pédalier -->
    <rect x="4" y="10" width="120" height="228" rx="12" fill="#000" opacity="0.65" filter="url(#pd-blur)" />

    <!-- Jacks entrée / sortie sur les côtés -->
    <g v-for="x in [-8, 120]" :key="x">
      <rect :x="x" y="34" width="8" height="18" rx="1.5" fill="url(#pd-chrome)" stroke="#1e293b" stroke-width="0.6" />
      <rect :x="x + 2" y="37" width="4" height="12" rx="1" fill="#0f172a" opacity="0.35" />
    </g>

    <!-- Boîtier -->
    <rect x="0" y="0" width="120" height="228" rx="11" class="body" />
    <rect x="0" y="0" width="120" height="228" rx="11" fill="#fff" opacity="0.07" filter="url(#pd-hammer)" />
    <rect x="0" y="0" width="120" height="228" rx="11" fill="url(#pd-light)" />
    <rect x="0" y="0" width="120" height="228" rx="11" fill="url(#pd-bevel)" />
    <rect x="0.6" y="0.6" width="118.8" height="226.8" rx="10.5" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="1" />
    <rect x="5" y="5" width="110" height="218" rx="7" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="1" />

    <!-- Vis -->
    <g v-for="[x, y] in screws" :key="x + '-' + y">
      <circle :cx="x" :cy="y" r="3" fill="url(#pd-chrome)" stroke="#000" stroke-opacity="0.4" stroke-width="0.5" />
      <line :x1="x - 1.8" :y1="y + 1.2" :x2="x + 1.8" :y2="y - 1.2" stroke="#1e293b" stroke-width="0.8" />
    </g>

    <!-- Mini-potards (position = réglages du preset) -->
    <g v-for="(k, i) in knobs" :key="k.label">
      <circle :cx="KNOB_X[i] + 1" :cy="31" r="10.5" fill="#000" opacity="0.5" filter="url(#pd-blur-s)" />
      <circle :cx="KNOB_X[i]" :cy="28" r="10" fill="url(#pd-knob)" stroke="#000" stroke-width="0.6" />
      <circle :cx="KNOB_X[i]" :cy="28" r="10" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="1.6" stroke-dasharray="0.8 1.4" />
      <circle :cx="KNOB_X[i]" :cy="28" r="6.5" fill="#111" stroke="#fff" stroke-opacity="0.1" stroke-width="0.6" />
      <line
        :x1="KNOB_X[i]"
        y1="21"
        :x2="KNOB_X[i]"
        y2="26"
        stroke="#f5f5f4"
        stroke-width="1.8"
        stroke-linecap="round"
        :transform="`rotate(${knobAngle(k.value)} ${KNOB_X[i]} 28)`"
      />
      <text :x="KNOB_X[i]" y="47" class="silk small" text-anchor="middle">{{ k.label }}</text>
    </g>

    <!-- LED -->
    <circle cx="60" cy="68" r="5.2" fill="url(#pd-chrome)" stroke="#000" stroke-opacity="0.4" stroke-width="0.5" />
    <circle cx="60" cy="68" r="3.4" :fill="active ? 'url(#pd-led-on)' : '#3a0909'" />
    <circle v-if="active" cx="60" cy="68" r="9" fill="#ff3b3b" opacity="0.35" filter="url(#pd-blur-s)" />

    <!-- Nom -->
    <text v-if="type === 'script'" x="60" y="113" class="name script" text-anchor="middle">{{ name }}</text>
    <text v-else x="60" y="110" class="name block" text-anchor="middle">{{ name }}</text>
    <text x="60" y="126" class="silk sub" text-anchor="middle">{{ sub }}</text>
    <line x1="30" y1="134" x2="90" y2="134" stroke="var(--ink)" stroke-opacity="0.35" stroke-width="0.8" />

    <!-- Footswitch : écrou hexagonal + bouton bombé qui s'enfonce -->
    <circle cx="61.5" cy="186" r="17" fill="#000" opacity="0.45" filter="url(#pd-blur-s)" />
    <polygon points="60,167 75.6,176 75.6,194 60,203 44.4,194 44.4,176" fill="url(#pd-chrome)" stroke="#1e293b" stroke-width="0.8" />
    <g class="stomp">
      <circle cx="62" cy="187.5" r="11" fill="#000" opacity="0.5" filter="url(#pd-blur-s)" />
      <circle cx="60" cy="185" r="11" fill="url(#pd-dome)" stroke="#1e293b" stroke-width="0.7" />
      <ellipse cx="56" cy="180.5" rx="4.5" ry="2.6" transform="rotate(-30 56 180.5)" fill="#fff" opacity="0.7" />
    </g>
    <text x="60" y="221" class="silk tiny" text-anchor="middle">FRETBOARD FX</text>
  </svg>
</template>

<style scoped>
.pedal-svg {
  width: 100%;
  height: auto;
  overflow: visible;
}
.body {
  fill: var(--body);
}
.silk {
  fill: var(--ink);
  font-weight: 800;
  text-transform: uppercase;
}
.small {
  font-size: 6.2px;
  letter-spacing: 0.12em;
  opacity: 0.85;
}
.sub {
  font-size: 6.5px;
  letter-spacing: 0.3em;
  opacity: 0.75;
}
.tiny {
  font-size: 4.6px;
  letter-spacing: 0.35em;
  opacity: 0.45;
}
.name {
  fill: var(--ink);
}
.name.script {
  font-family: 'Yellowtail', cursive;
  font-size: 30px;
}
.name.block {
  font-size: 19px;
  font-weight: 900;
  font-style: italic;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.stomp {
  transition: transform 0.08s;
}
.active .stomp {
  transform: translateY(1.5px) scale(0.98);
  transform-origin: 60px 185px;
}
</style>
