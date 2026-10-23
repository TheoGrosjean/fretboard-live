<script setup>
// Bibliothèque des phrasés : recherche, « à revoir aujourd'hui » (révision espacée), vignette du contour
// mélodique, maîtrise. Importer / exporter dans un fichier. Repliable en une fine colonne.
import { computed, inject, ref } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import { contour } from '../../lib/phrases'
import { isDue, mastery, reviewLabel } from '../../lib/phraseCoach'
import Icon from '../Icon.vue'

const s = inject(STUDIO_KEY)
const query = ref('')
const fileInput = ref(null)
const matches = (p) => !query.value.trim() || p.name.toLowerCase().includes(query.value.trim().toLowerCase())
const due = computed(() => s.phrases.filter((p) => isDue(p) && matches(p)))
const rest = computed(() => s.phrases.filter((p) => !isDue(p) && matches(p)))
const bars = (p) => Math.round(p.lengthBeats / p.beats)
// Vignette : le contour mélodique du phrasé (hauteur dans le temps)
function sparkline(p) {
  const pts = contour(p.notes, p.lengthBeats)
  if (!pts.length) return ''
  return pts.map((q, i) => `${i ? 'L' : 'M'} ${(4 + q.x * 92).toFixed(1)} ${(20 - q.y * 16).toFixed(1)}`).join(' ')
}
function onFile(e) {
  const file = e.target.files?.[0]
  if (file) s.importFile(file)
  e.target.value = ''
}
</script>

<template>
  <!-- Replié : une fine colonne (déplier, nouveau phrasé, pastilles des phrasés) -->
  <aside v-if="!s.libraryOpen" class="flex shrink-0 items-center gap-2 lg:w-12 lg:flex-col">
    <button class="lib-toggle" title="Afficher mes phrasés" aria-label="Afficher mes phrasés" @click="s.libraryOpen = true">
      <Icon name="expand" class="size-4" />
    </button>
    <button class="lib-toggle text-lg" title="Nouveau phrasé" aria-label="Nouveau phrasé" @click="s.createPhrase">+</button>
    <span class="h-px w-6 bg-white/10 max-lg:hidden" />
    <button v-for="p in s.phrases" :key="p.id" class="lib-dot" :class="{ on: p.id === s.selectedId }" :title="`${p.name}${isDue(p) ? ' · à revoir' : ''}`" @click="s.selectPhrase(p.id)">
      {{ p.name.trim().charAt(0).toUpperCase() || '·' }}
      <span v-if="isDue(p)" class="due-dot" />
    </button>
  </aside>

  <aside v-else class="flex shrink-0 flex-col gap-3 lg:w-64">
    <div class="flex items-center justify-between">
      <h2 class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Mes phrasés <span class="ml-1 text-neutral-600 tabular-nums">{{ s.phrases.length }}</span></h2>
      <button class="lib-toggle size-7" title="Replier" aria-label="Replier mes phrasés" @click="s.libraryOpen = false">
        <Icon name="collapse" class="size-4" />
      </button>
    </div>
    <button class="new-btn" @click="s.createPhrase">
      <span class="text-lg leading-none">+</span>
      Nouveau phrasé
    </button>
    <label v-if="s.phrases.length > 4" class="search">
      <Icon name="search" class="size-3.5 text-neutral-500" />
      <input v-model="query" type="search" placeholder="Chercher" aria-label="Chercher un phrasé" />
    </label>

    <template v-for="group in [{ id: 'due', title: 'À revoir aujourd’hui', list: due }, { id: 'rest', title: due.length ? 'Les autres' : '', list: rest }]" :key="group.id">
      <div v-if="group.list.length && group.title" class="mt-1 flex items-center gap-2 text-[10px] font-semibold tracking-widest uppercase" :class="group.id === 'due' ? 'text-copper-300' : 'text-neutral-600'">
        <span v-if="group.id === 'due'" class="size-1.5 rounded-full bg-copper-400" />
        {{ group.title }}
      </div>
      <ul class="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        <li v-for="p in group.list" :key="p.id" class="shrink-0">
          <button class="lib-item" :class="{ on: p.id === s.selectedId }" @click="s.selectPhrase(p.id)">
            <span class="flex w-full items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-bold text-neutral-100">{{ p.name }}</span>
              <svg v-if="p.notes.length" class="h-6 w-16 shrink-0" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                <path :d="sparkline(p)" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" class="text-copper-400/80" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="flex w-full items-center gap-2 text-xs text-neutral-500">
              <span>{{ p.notes.length ? `${p.notes.length} notes · ${bars(p)} mes.` : 'à enregistrer' }}</span>
              <span v-if="p.bestBpm" class="text-copper-300">{{ p.bestBpm }} BPM</span>
              <span v-if="reviewLabel(p) && reviewLabel(p) !== 'à revoir'" class="ml-auto text-neutral-600">{{ reviewLabel(p) }}</span>
            </span>
            <span v-if="p.bestBpm" class="mastery" :title="`Maîtrise ${mastery(p)} %`"><i :style="{ width: mastery(p) + '%' }" /></span>
          </button>
        </li>
      </ul>
    </template>
    <p v-if="query && !due.length && !rest.length" class="text-xs text-neutral-600">Aucun phrasé ne correspond.</p>

    <div class="mt-1 flex items-center gap-3 text-xs">
      <button class="font-semibold text-neutral-500 hover:text-neutral-200" title="Ajouter des phrasés depuis un fichier exporté" @click="fileInput.click()">Importer…</button>
      <button v-if="s.phrases.length" class="font-semibold text-neutral-500 hover:text-neutral-200" title="Enregistrer tous tes phrasés dans un fichier" @click="s.exportAll">Tout exporter</button>
      <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" @change="onFile" />
    </div>
    <p v-if="s.importError" class="text-xs text-rose-300">{{ s.importError }}</p>
  </aside>
</template>

<style scoped>
@reference "../../style.css";

.new-btn {
  @apply flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm font-semibold text-neutral-300 transition hover:border-copper-400/60 hover:text-copper-300;
}
.lib-toggle {
  @apply flex size-9 shrink-0 items-center justify-center rounded-xl font-bold text-neutral-400 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white;
}
.lib-dot {
  @apply relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-sm font-black text-neutral-400 ring-1 ring-white/5 transition hover:text-white;
}
.lib-dot.on {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/50;
}
.due-dot {
  @apply absolute -top-0.5 -right-0.5 size-2 rounded-full bg-copper-400 ring-2 ring-neutral-950;
}
.search {
  @apply flex h-9 items-center gap-2 rounded-xl bg-neutral-900 px-3 ring-1 ring-white/10 focus-within:ring-copper-400/50;
}
.search input {
  @apply min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600;
}
.lib-item {
  @apply flex w-60 flex-col items-start gap-1 rounded-xl px-3.5 py-2.5 text-left ring-1 ring-white/5 transition hover:bg-white/[0.03] lg:w-full;
}
.lib-item.on {
  @apply bg-copper-500/10 ring-copper-400/40;
}
.mastery {
  @apply mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-copper-500/15;
}
.mastery i {
  @apply block h-full rounded-full bg-copper-500;
}
</style>
