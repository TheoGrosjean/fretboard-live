<script setup>
// Interrupteur à bascule encastrable (rocker) : « O » en haut, « I » en bas, le côté appuyé s'enfonce
defineProps({ on: { type: Boolean, default: false } })

// Position de l'axe de bascule : la moitié sortie paraît plus longue (perspective)
const PIVOT = { off: 37, on: 31 }
</script>

<template>
  <svg class="rocker" :class="{ on }" viewBox="0 0 44 68" width="46" height="71" aria-hidden="true">
    <defs>
      <linearGradient id="rk-bezel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a3a3a" />
        <stop offset="0.5" stop-color="#1a1a1a" />
        <stop offset="1" stop-color="#0a0a0a" />
      </linearGradient>
      <!-- Moitié sortie : face éclairée -->
      <linearGradient id="rk-up" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a4a4a" />
        <stop offset="0.25" stop-color="#2c2c2c" />
        <stop offset="1" stop-color="#1b1b1b" />
      </linearGradient>
      <!-- Moitié enfoncée : dans l'ombre, plus sombre près de l'axe -->
      <linearGradient id="rk-down-bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#050505" />
        <stop offset="0.5" stop-color="#121212" />
        <stop offset="1" stop-color="#181818" />
      </linearGradient>
      <linearGradient id="rk-down-top" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#181818" />
        <stop offset="0.5" stop-color="#121212" />
        <stop offset="1" stop-color="#050505" />
      </linearGradient>
      <filter id="rk-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2" /></filter>
    </defs>

    <!-- Ombre portée et cadre encastré -->
    <rect x="5" y="6" width="38" height="61" rx="5" fill="#000" opacity="0.55" filter="url(#rk-blur)" />
    <rect x="2" y="2" width="40" height="64" rx="4.5" fill="url(#rk-bezel)" stroke="#000" stroke-width="1" />
    <rect x="2.6" y="2.6" width="38.8" height="62.8" rx="4" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="0.8" />
    <rect x="6.5" y="6.5" width="31" height="55" rx="2" fill="#030303" />

    <!-- Éteint : « O » sorti, « I » enfoncé -->
    <g class="state off-state">
      <rect x="8" y="8" width="28" :height="PIVOT.off - 8" rx="1.5" fill="url(#rk-up)" />
      <rect x="8" y="8" width="28" height="1.6" rx="0.8" fill="#fff" opacity="0.22" />
      <rect x="8" :y="PIVOT.off" width="28" :height="60 - PIVOT.off" rx="1.5" fill="url(#rk-down-bottom)" />
      <rect x="8" :y="PIVOT.off - 1" width="28" height="2" fill="#000" opacity="0.8" />
      <circle cx="22" :cy="(8 + PIVOT.off) / 2" r="4.2" fill="none" stroke="#e7e5e4" stroke-width="1.6" />
      <rect x="21.2" :y="PIVOT.off + 6" width="1.6" height="9" rx="0.8" fill="#a8a29e" opacity="0.45" />
    </g>

    <!-- Allumé : « I » sorti, « O » enfoncé -->
    <g class="state on-state">
      <rect x="8" y="8" width="28" :height="PIVOT.on - 8" rx="1.5" fill="url(#rk-down-top)" />
      <rect x="8" :y="PIVOT.on" width="28" :height="60 - PIVOT.on" rx="1.5" fill="url(#rk-up)" />
      <rect x="8" :y="PIVOT.on" width="28" height="1.6" rx="0.8" fill="#fff" opacity="0.22" />
      <rect x="8" :y="PIVOT.on - 1.2" width="28" height="1.4" fill="#000" opacity="0.8" />
      <circle cx="22" :cy="(8 + PIVOT.on) / 2" r="3.8" fill="none" stroke="#a8a29e" stroke-width="1.4" opacity="0.45" />
      <rect x="21.1" :y="PIVOT.on + 8" width="1.8" height="11" rx="0.9" fill="#e7e5e4" />
    </g>
  </svg>
</template>

<style scoped>
.state {
  transition: opacity 0.08s;
}
.on-state,
.on .off-state {
  opacity: 0;
}
.on .on-state {
  opacity: 1;
}
</style>
