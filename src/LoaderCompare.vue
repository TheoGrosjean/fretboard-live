<script setup>
import { nextTick, onMounted, ref } from 'vue'
import LoaderString from './components/loaders/LoaderString.vue'
import LoaderNeck from './components/loaders/LoaderNeck.vue'

const LOADERS = [
  { id: 'string', name: 'Corde pincée', component: LoaderString },
  { id: 'neck', name: 'Manche qui se dessine', component: LoaderNeck },
]
const runs = ref({ string: 0, neck: 0 }) // changer la clé relance l'animation
const fullscreen = ref(null)
const replay = (id) => (runs.value = { ...runs.value, [id]: runs.value[id] + 1 })

// ?t=1200 : fige toutes les animations à cet instant (pour vérifier une étape précise)
const freezeAt = new URLSearchParams(location.search).has('t') ? Number(new URLSearchParams(location.search).get('t')) : null
onMounted(async () => {
  if (freezeAt === null) return
  await nextTick()
  document.getAnimations().forEach((a) => {
    a.pause()
    a.currentTime = freezeAt
  })
})
</script>

<template>
  <div class="min-h-screen bg-anthracite px-6 py-8 text-neutral-200">
    <header class="mx-auto mb-8 max-w-[1500px]">
      <h1 class="text-2xl font-black text-white">Choisis l'animation de chargement</h1>
      <p class="text-sm text-neutral-500">Chaque aperçu se rejoue ; « Plein écran » montre l'animation telle qu'au lancement du site.</p>
    </header>

    <div class="mx-auto grid max-w-[1500px] gap-8 lg:grid-cols-2">
      <section v-for="(l, i) in LOADERS" :key="l.id">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="flex items-baseline gap-3 text-lg font-bold text-white">
            <span class="flex size-8 items-center justify-center rounded-lg bg-neutral-800 text-base text-neutral-300">{{ i + 1 }}</span>
            {{ l.name }}
          </h2>
          <div class="flex gap-2 text-sm">
            <button class="rounded-lg bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700" @click="replay(l.id)">Rejouer</button>
            <button class="rounded-lg bg-copper-500 px-3 py-1.5 font-semibold text-white hover:bg-copper-400" @click="fullscreen = l">Plein écran</button>
          </div>
        </div>
        <div class="relative aspect-video overflow-hidden rounded-2xl ring-1 ring-white/10">
          <!-- Fond « app » derrière l'aperçu, révélé à la fin de l'animation -->
          <div class="absolute inset-0 flex items-center justify-center text-sm text-neutral-600">(l'app apparaît ici)</div>
          <component :is="l.component" :key="runs[l.id]" :freeze-at="freezeAt" />
        </div>
      </section>
    </div>

    <div v-if="fullscreen" class="fixed inset-0 z-50">
      <component :is="fullscreen.component" @done="fullscreen = null" />
    </div>
  </div>
</template>
