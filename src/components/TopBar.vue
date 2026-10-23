<script setup>
// Barre du haut, commune à toutes les pages : logo, navigation Manche / Phrasés / Théorie / Ampli, actions de la page.
// Les pages y placent leurs boutons par <Teleport to="#topbar-lead"> (à gauche) et "#topbar-actions" (à droite).
import Icon from './Icon.vue'
import { ampOn } from '../lib/ampStatus'

const props = defineProps({ current: { type: String, required: true } }) // 'manche' | 'phrases' | 'theorie' | 'ampli' | ''

// Fondu de sortie de la page avant de changer d'onglet (le fondu d'entrée est géré par Root.vue)
const LEAVE_MS = 220
function go(e, t) {
  if (t.id === props.current || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return void (location.hash = t.href)
  document.documentElement.classList.add('page-leave')
  setTimeout(() => (location.hash = t.href), LEAVE_MS)
}

const TABS = [
  { id: 'manche', label: 'Manche', href: '#', icon: 'music' },
  { id: 'phrases', label: 'Phrasés', href: '#phrases', icon: 'repeat' },
  { id: 'theorie', label: 'Théorie', href: '#theorie', icon: 'book' },
  { id: 'ampli', label: 'Ampli', href: '#ampli', icon: 'volume', badge: 'test' },
]
</script>

<template>
  <header class="topbar sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-white/[0.06] px-3 sm:gap-4 sm:px-5">
    <div id="topbar-lead" class="flex items-center" />
    <a href="#" class="flex shrink-0 items-center gap-2 max-sm:hidden" @click="go($event, TABS[0])">
      <!-- Logo : trois cordes et une note -->
      <svg class="size-7" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="8" fill="#1c1917" />
        <path d="M5 9h18M5 14h18M5 19h18" stroke="#57534e" stroke-width="1.4" />
        <circle cx="17" cy="14" r="4" fill="var(--color-copper-400)" />
      </svg>
      <span class="text-[17px] font-black tracking-tight whitespace-nowrap text-white">Fretboard <span class="text-copper-400">Live</span></span>
    </a>

    <nav class="flex h-full items-stretch sm:ml-4">
      <a
        v-for="t in TABS"
        :key="t.id"
        :href="t.href"
        class="tab relative flex items-center gap-2 px-2.5 text-sm transition sm:px-4"
        :class="t.id === current ? 'is-active font-semibold text-white' : 'font-medium text-neutral-400 hover:text-neutral-100'"
        :aria-current="t.id === current ? 'page' : undefined"
        @click="go($event, t)"
      >
        <Icon :name="t.icon" class="size-[18px]" />
        <!-- Sur téléphone, icônes seules (le trait cuivré marque la page courante) -->
        <span class="max-sm:hidden">{{ t.label }}</span>
        <span v-if="t.badge" class="text-[9px] font-bold tracking-wider text-copper-400 uppercase max-sm:hidden">{{ t.badge }}</span>
        <!-- Voyant : l'ampli virtuel est allumé (il continue de jouer sur les autres onglets) -->
        <span v-if="t.id === 'ampli' && ampOn" class="amp-led" title="Ampli allumé" />
      </a>
    </nav>

    <div id="topbar-actions" class="ml-auto flex items-center gap-2" />
  </header>
</template>

<style scoped>
.topbar {
  background: color-mix(in srgb, #141312 82%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
/* Page courante : trait cuivré sous l'onglet, collé au bas de la barre */
.tab::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-copper-400);
  box-shadow: 0 0 12px 1px color-mix(in srgb, var(--color-copper-400) 60%, transparent);
  transform: scaleX(0);
  transition: transform 0.25s ease;
}
.tab.is-active::after {
  transform: scaleX(1);
}
.tab:not(.is-active):hover::after {
  transform: scaleX(0.4);
  opacity: 0.4;
}
.amp-led {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-copper-400);
  box-shadow: 0 0 8px 2px color-mix(in srgb, var(--color-copper-400) 70%, transparent);
  animation: led 1.6s ease-in-out infinite;
}
@keyframes led {
  50% {
    opacity: 0.55;
  }
}
</style>
