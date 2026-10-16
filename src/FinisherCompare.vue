<script setup>
import { nextTick, onMounted, ref } from 'vue'
import Fretboard from './components/Fretboard.vue'
import FinisherFight from './components/finishers/FinisherFight.vue'
import FinisherPersona from './components/finishers/FinisherPersona.vue'
import FinisherResults from './components/finishers/FinisherResults.vue'
import FinisherCinematic from './components/finishers/FinisherCinematic.vue'
import { SCALES, STANDARD_TUNING, buildOverlay } from './lib/music'

const FINISHERS = [
  { id: 'fight', name: 'FINISH! (jeu de combat)', component: FinisherFight },
  { id: 'persona', name: 'Persona / anime', component: FinisherPersona },
  { id: 'results', name: 'Résultats (jeu de rythme)', component: FinisherResults },
  { id: 'cinematic', name: 'Fin cinématique', component: FinisherCinematic },
]

// Exemple de fin de morceau
const result = {
  rank: 'S',
  word: 'PERFECT!',
  title: 'Slow Blues Backing Track in A minor',
  artist: 'Guitar Jam Tracks',
  score: 48250,
  bestCombo: 87,
  accuracy: 94,
  newRecord: true,
  style: 'Mélancolique',
}
const overlay = buildOverlay(9, SCALES.find((s) => s.id === 'penta-minor'))

const runs = ref(Object.fromEntries(FINISHERS.map((f) => [f.id, 0])))
const fullscreen = ref(null)
const replay = (id) => (runs.value = { ...runs.value, [id]: runs.value[id] + 1 })

// ?t=1500 : fige les aperçus à cet instant (vérification d'une étape)
const params = new URLSearchParams(location.search)
const freezeAt = params.has('t') ? Number(params.get('t')) : null
onMounted(async () => {
  if (freezeAt === null) return
  await nextTick()
  setTimeout(() => document.getAnimations().forEach((a) => (a.pause(), (a.currentTime = freezeAt))), 50)
})
</script>

<template>
  <div class="min-h-screen bg-anthracite px-6 py-8 text-neutral-200">
    <header class="mx-auto mb-8 max-w-[1600px]">
      <h1 class="text-2xl font-black text-white">Choisis le finisher de fin de morceau</h1>
      <p class="text-sm text-neutral-500">Exemple : rang S, nouveau record. « Plein écran » le montre comme à la fin d'un backing track ; clique dessus pour le fermer.</p>
    </header>

    <div class="mx-auto grid max-w-[1600px] gap-8 xl:grid-cols-2">
      <section v-for="(f, i) in FINISHERS" :key="f.id">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="flex items-baseline gap-3 text-lg font-bold text-white">
            <span class="flex size-8 items-center justify-center rounded-lg bg-neutral-800 text-base text-neutral-300">{{ i + 1 }}</span>
            {{ f.name }}
          </h2>
          <div class="flex gap-2 text-sm">
            <button class="rounded-lg bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700" @click="replay(f.id)">Rejouer</button>
            <button class="rounded-lg bg-copper-500 px-3 py-1.5 font-semibold text-white hover:bg-copper-400" @click="fullscreen = f">Plein écran</button>
          </div>
        </div>
        <div class="relative aspect-video overflow-hidden rounded-2xl ring-1 ring-white/10">
          <div class="pointer-events-none absolute inset-0 flex items-center bg-anthracite p-4 opacity-80">
            <Fretboard class="w-full" :tuning="STANDARD_TUNING" :frets="22" :overlay="overlay" notation="fr" />
          </div>
          <component :is="f.component" :key="runs[f.id]" :result="result" :freeze-at="freezeAt" @close="replay(f.id)" />
        </div>
      </section>
    </div>

    <div v-if="fullscreen" class="fixed inset-0 z-50 bg-anthracite">
      <div class="pointer-events-none absolute inset-0 flex items-center p-8 opacity-80">
        <Fretboard class="w-full" :tuning="STANDARD_TUNING" :frets="22" :overlay="overlay" notation="fr" />
      </div>
      <component :is="fullscreen.component" :result="result" @close="fullscreen = null" />
    </div>
  </div>
</template>
