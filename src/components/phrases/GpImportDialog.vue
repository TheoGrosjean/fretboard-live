<script setup>
// Import d'une tablature Guitar Pro : choix de la piste, puis des mesures à travailler (clic, glisser,
// Maj + clic ou deux touchers pour étendre, ou une section du morceau), et création du phrasé.
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import { MAX_IMPORT_BARS, barOverview, guitarTracks, phraseFromBars, readScore, scoreSections } from '../../lib/gpImport'
import { TUNINGS, noteName } from '../../lib/music'
import { gridName } from '../../lib/phrases'

const s = inject(STUDIO_KEY)
const score = shallowRef(null)
const error = ref('')
readScore(s.gpFile)
  .then((sc) => {
    score.value = sc
    if (!tracks.value.length) error.value = 'Aucune piste de guitare dans ce fichier.'
  })
  .catch(() => (error.value = 'Ce fichier Guitar Pro est illisible.'))

const tracks = computed(() => (score.value ? guitarTracks(score.value) : []))
const trackIndex = ref(null)
watch(tracks, (list) => (trackIndex.value = list[0]?.index ?? null))
const track = computed(() => tracks.value.find((t) => t.index === trackIndex.value) ?? null)
const bars = computed(() => (score.value && track.value ? barOverview(score.value, track.value.index) : []))
const sections = computed(() => (score.value ? scoreSections(score.value) : []))
const title = computed(() => [score.value?.title?.trim(), score.value?.artist?.trim()].filter(Boolean).join(' — ') || s.gpFile.name)

// Accordage de la tablature comparé à celui du manche
const sameNotes = (a, b) => a.length === b.length && a.every((m, i) => m === b[i])
const tabTuning = computed(() => track.value?.tuning ?? [])
const tuningMatch = computed(() => sameNotes(tabTuning.value, s.tuning))
const knownTuning = computed(() => TUNINGS.find((t) => sameNotes(t.notes, tabTuning.value)) ?? null)
const tuningLabel = computed(() => knownTuning.value?.name ?? [...tabTuning.value].reverse().map((m) => noteName(m, s.notation)).join(' '))

// Sélection des mesures : [from, to] inclus, au plus MAX_IMPORT_BARS
const anchor = ref(null)
const end = ref(null)
const range = computed(() => (anchor.value === null ? null : [Math.min(anchor.value, end.value), Math.max(anchor.value, end.value)]))
const clipped = ref(false)
function extendTo(i) {
  const limit = MAX_IMPORT_BARS - 1
  clipped.value = Math.abs(i - anchor.value) > limit
  end.value = Math.max(anchor.value - limit, Math.min(anchor.value + limit, i))
}
let dragging = false
function down(e, i) {
  const single = anchor.value !== null && anchor.value === end.value
  if (anchor.value !== null && (e.shiftKey || (e.pointerType === 'touch' && single && i !== anchor.value))) extendTo(i)
  else {
    anchor.value = end.value = i
    clipped.value = false
    dragging = e.pointerType !== 'touch'
  }
}
function move(e) {
  if (!dragging) return
  const i = Number(document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-bar]')?.dataset.bar)
  if (Number.isInteger(i)) extendTo(i)
}
const up = () => (dragging = false)
addEventListener('pointerup', up)
function pickSection(sec) {
  anchor.value = sec.from
  extendTo(sec.to)
}
const inRange = (i) => range.value && i >= range.value[0] && i <= range.value[1]
watch(trackIndex, () => (anchor.value = end.value = null))

const draft = computed(() => (range.value && track.value ? phraseFromBars(score.value, track.value.index, range.value[0], range.value[1], s.tuning) : null))
const lowest = computed(() => Math.min(...s.tuning))
const tooLow = computed(() => draft.value?.notes.some((n) => n.midi < lowest.value) ?? false)
const barCount = computed(() => (range.value ? range.value[1] - range.value[0] + 1 : 0))
function create() {
  if (draft.value?.notes.length) s.addImported(draft.value)
}
const close = () => (s.gpFile = null)
const onKey = (e) => e.key === 'Escape' && close()
addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  removeEventListener('pointerup', up)
  removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="close">
    <div class="dialog" role="dialog" aria-label="Importer une tablature Guitar Pro">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-semibold tracking-widest text-copper-400 uppercase">Importer une tablature</div>
          <h3 class="mt-1 truncate text-xl font-black text-white">{{ title }}</h3>
        </div>
        <button class="secondary size-9 px-0" title="Fermer (Échap)" aria-label="Fermer" @click="close">✕</button>
      </div>

      <p v-if="error" class="mt-4 text-sm text-rose-300">{{ error }}</p>
      <p v-else-if="!score" class="mt-4 text-sm text-neutral-400">Lecture du fichier…</p>

      <template v-else-if="track">
        <!-- Piste -->
        <div v-if="tracks.length > 1" class="mt-4 flex flex-wrap gap-1.5">
          <button v-for="t in tracks" :key="t.index" class="chip" :class="{ on: t.index === trackIndex }" @click="trackIndex = t.index">{{ t.name }}</button>
        </div>
        <p class="mt-3 text-xs text-neutral-400">
          Accordage de la tablature : <b class="text-neutral-200">{{ tuningLabel }}</b>
          <template v-if="!tuningMatch">
            <span class="text-amber-300"> · différent de ton manche.</span>
            <button v-if="knownTuning" class="ml-1 font-semibold text-copper-300 hover:text-copper-300" @click="s.tuningId = knownTuning.id">Passer le manche en {{ knownTuning.name.split('· ').at(-1) }}</button>
          </template>
        </p>

        <!-- Sections du morceau -->
        <div v-if="sections.length" class="mt-4 flex flex-wrap gap-1.5">
          <button v-for="sec in sections" :key="sec.from" class="chip" :class="{ on: range && range[0] === sec.from && range[1] === sec.to }" :title="`Mesures ${sec.from + 1} à ${sec.to + 1}`" @click="pickSection(sec)">{{ sec.name }}</button>
        </div>

        <!-- Mesures -->
        <p class="mt-4 text-xs text-neutral-500">Clique une mesure, puis glisse (ou Maj + clic, ou touche une deuxième mesure) pour choisir jusqu'à {{ MAX_IMPORT_BARS }} mesures.</p>
        <div class="bars" @pointermove="move">
          <button v-for="b in bars" :key="b.index" :data-bar="b.index" class="bar" :class="{ on: inRange(b.index), empty: !b.dots.length, start: b.section }" :title="b.section ? `${b.section} · mesure ${b.index + 1}` : `Mesure ${b.index + 1}`" @pointerdown.prevent="down($event, b.index)">
            <span class="num">{{ b.index + 1 }}</span>
            <!-- Notes de la mesure : points ronds quelle que soit la largeur de la case (trait de longueur nulle) -->
            <svg class="absolute top-4 left-1.5 h-6 w-[calc(100%-0.75rem)]" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path v-for="(d, k) in b.dots" :key="k" :d="`M ${d.x * 100} ${100 - d.y * 100} h 0`" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" />
            </svg>
          </button>
        </div>

        <!-- Récapitulatif -->
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="min-w-64 flex-1 text-sm text-neutral-400">
            <template v-if="draft">
              <b class="text-neutral-100">Mesures {{ range[0] + 1 }}{{ barCount > 1 ? ` à ${range[1] + 1}` : '' }}</b>
              · {{ draft.notes.length }} notes · {{ draft.bpm }} BPM · {{ gridName(draft.grid).toLowerCase() }}
              <span v-if="clipped" class="block text-xs text-amber-300">Limité à {{ MAX_IMPORT_BARS }} mesures.</span>
              <span v-if="draft.snapped" class="block text-xs text-amber-300">Certaines notes très rapides sont arrondies à la double croche ou au triolet.</span>
              <span v-if="tooLow" class="block text-xs text-amber-300">Des notes sont plus graves que la corde la plus grave de ton manche.</span>
              <span v-if="!draft.notes.length" class="block text-xs text-amber-300">Ces mesures n'ont aucune note à jouer.</span>
            </template>
            <template v-else>Aucune mesure choisie.</template>
          </div>
          <button class="primary max-sm:w-full" :disabled="!draft?.notes.length" @click="create">Créer le phrasé et s'entraîner</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@reference "../../style.css";

.dialog {
  @apply max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 shadow-2xl ring-1 ring-white/10;
  background: #1a1817;
}
.chip {
  @apply h-8 max-w-56 truncate rounded-lg px-3 text-xs font-semibold text-neutral-400 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white;
}
.chip.on {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/50;
}
.bars {
  @apply mt-2 grid max-h-[40vh] grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1 overflow-y-auto p-0.5 select-none;
}
.bar {
  @apply relative h-12 rounded-md bg-neutral-900 ring-1 ring-white/5 transition-colors hover:ring-white/20;
  stroke: var(--color-neutral-500);
}
.bar.empty {
  @apply bg-neutral-900/40;
}
.bar.start {
  @apply border-l-2 border-copper-400/60;
}
.bar.on {
  @apply bg-copper-500/20 ring-copper-400/60;
  stroke: var(--color-copper-300);
}
.num {
  @apply absolute top-0.5 left-1.5 text-[9px] font-semibold text-neutral-500 tabular-nums;
}
.bar.on .num {
  @apply text-copper-300;
}
.primary {
  @apply h-9 rounded-xl bg-copper-500 px-4 text-sm font-bold text-white hover:bg-copper-400 disabled:cursor-not-allowed disabled:opacity-40;
}
.secondary {
  @apply flex h-9 items-center justify-center rounded-xl px-4 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 hover:bg-white/5;
}
</style>
