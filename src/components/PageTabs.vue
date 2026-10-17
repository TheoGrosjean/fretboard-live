<script setup>
// Sélecteur d'onglets Manche / Ampli, au même endroit (en haut à droite) sur les deux pages
import Icon from './Icon.vue'

const props = defineProps({ current: { type: String, required: true } }) // 'manche' | 'ampli'

// Fondu de sortie avant de changer d'onglet (le changement recharge la page, voir main.js)
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
  { id: 'ampli', label: 'Ampli', href: '#ampli', icon: 'volume', badge: 'test' },
]
</script>

<template>
  <nav class="flex shrink-0 rounded-xl bg-neutral-900/80 p-1 text-sm ring-1 ring-white/10 backdrop-blur">
    <a
      v-for="t in TABS"
      :key="t.id"
      :href="t.href"
      class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition sm:px-4"
      :class="t.id === current ? 'bg-neutral-200 font-semibold text-neutral-950' : 'font-medium text-neutral-400 hover:bg-white/5 hover:text-neutral-100'"
      :aria-current="t.id === current ? 'page' : undefined"
      @click="go($event, t)"
    >
      <Icon :name="t.icon" class="size-4" />
      {{ t.label }}
      <span v-if="t.badge" class="text-[10px] font-bold uppercase" :class="t.id === current ? 'text-copper-600' : 'text-copper-400'">{{ t.badge }}</span>
    </a>
  </nav>
</template>
