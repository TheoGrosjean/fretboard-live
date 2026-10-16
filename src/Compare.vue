<script setup>
import { ref } from 'vue'
import Fretboard from './components/Fretboard.vue'
import { PALETTES } from './lib/noteStyles'
import { SCALES, STANDARD_TUNING, buildOverlay, findPositions } from './lib/music'

// Même situation pour toutes les palettes : La pentatonique mineure, Mi joué corde 2 case 5
const overlay = buildOverlay(9, SCALES.find((s) => s.id === 'penta-minor'))
const played = { midi: 64, string: 1, fret: 5 }
const alternates = findPositions(64, STANDARD_TUNING, 22).filter((p) => p.string !== played.string || p.fret !== played.fret)
const anchor = { fret: 5, string: 2 }

const labelMode = ref('note')
</script>

<template>
  <div class="min-h-screen bg-anthracite px-6 py-8 text-neutral-200">
    <header class="mx-auto mb-8 flex max-w-[1500px] flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-black text-white">Choisis ta palette</h1>
        <p class="text-sm text-neutral-500">
          La pentatonique mineure · Mi joué (corde 2, case 5) en couleur pleine · même note ailleurs en pointillés · tonique entourée.
        </p>
      </div>
      <div class="grid grid-cols-2 gap-1 rounded-xl bg-neutral-800 p-1 text-sm">
        <button
          v-for="m in [
            { id: 'note', label: 'Noms des notes' },
            { id: 'degree', label: 'Degrés' },
          ]"
          :key="m.id"
          class="rounded-lg px-3 py-1.5 font-medium transition"
          :class="labelMode === m.id ? 'bg-neutral-200 text-neutral-950' : 'text-neutral-400 hover:text-neutral-200'"
          @click="labelMode = m.id"
        >
          {{ m.label }}
        </button>
      </div>
    </header>

    <div class="mx-auto max-w-[1500px] space-y-10">
      <section v-for="(pal, i) in PALETTES" :key="pal.id">
        <h2 class="mb-3 flex items-baseline gap-3 text-lg font-bold text-white">
          <span class="flex size-8 items-center justify-center rounded-lg bg-neutral-800 text-base text-neutral-300">{{ i + 1 }}</span>
          {{ pal.name }}
        </h2>
        <Fretboard
          :tuning="STANDARD_TUNING"
          :frets="22"
          :overlay="overlay"
          notation="fr"
          :label-mode="labelMode"
          :played="played"
          :alternates="alternates"
          :anchor="anchor"
          :palette="pal.id"
        />
      </section>
    </div>
  </div>
</template>
