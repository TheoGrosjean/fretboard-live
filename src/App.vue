<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import Fretboard from './components/Fretboard.vue'
import Tuner from './components/Tuner.vue'
import ComboPanel from './components/ComboPanel.vue'
import Icon from './components/Icon.vue'
import SpotifyPlayer from './components/SpotifyPlayer.vue'
import { useAudioInput } from './composables/useAudioInput'
import { useCombo } from './composables/useCombo'
import {
  ARPEGGIOS,
  NOTE_NAMES,
  SCALES,
  STANDARD_TUNING,
  buildOverlay,
  estimatePosition,
  findPositions,
  noteName,
  pitchClass,
  updateAnchor,
} from './lib/music'
import { keyFromTitle } from './lib/keyFromTitle'

// ---------- Réglages persistés ----------
function persisted(key, initial) {
  const stored = localStorage.getItem(`fb.${key}`)
  const r = ref(stored !== null ? JSON.parse(stored) : initial)
  watch(r, (v) => localStorage.setItem(`fb.${key}`, JSON.stringify(v)))
  return r
}

const sidebarOpen = persisted('sidebarOpen', true)
const overlayType = persisted('overlayType', 'scale') // 'scale' | 'arpeggio' | 'none'
const root = persisted('root', 9) // La
const scaleId = persisted('scaleId', 'penta-minor')
const arpeggioId = persisted('arpeggioId', 'm7')
const notation = persisted('notation', 'fr')
const labelMode = persisted('labelMode', 'note')
const frets = persisted('frets', 22)
const showAlternates = persisted('showAlternates', true)

const tuning = STANDARD_TUNING

const pattern = computed(() => {
  if (overlayType.value === 'scale') return SCALES.find((s) => s.id === scaleId.value)
  if (overlayType.value === 'arpeggio') return ARPEGGIOS.find((a) => a.id === arpeggioId.value)
  return null
})
const overlay = computed(() => buildOverlay(root.value, pattern.value))
const overlayTitle = computed(() =>
  pattern.value ? `${NOTE_NAMES[notation.value][root.value]} ${pattern.value.name}` : 'Aucune gamme',
)

// Recherche Spotify proposée selon la tonalité choisie (ex. « A minor backing track »)
const backingSuggestion = computed(() => {
  if (!pattern.value) return 'guitar backing track'
  const minor = pattern.value.intervals.includes(3) && !pattern.value.intervals.includes(4)
  return `${NOTE_NAMES.en[root.value]} ${minor ? 'minor' : 'major'} backing track`
})

// ---------- Tonalité suivant le morceau Spotify ----------
const quality = (p) => (p.intervals.includes(3) && !p.intervals.includes(4) ? 'minor' : 'major')
const keySync = shallowRef(null) // { title, state } : réglage appliqué d'après le morceau

function onTrackChange(track) {
  // Titre d'abord, puis nom de l'album (souvent « Backing Tracks in A minor »)
  const key = keyFromTitle(track.name) ?? keyFromTitle(track.album)
  if (!key) return // rien de fiable : on garde la gamme choisie

  root.value = key.root
  if (key.scale) {
    overlayType.value = 'scale'
    scaleId.value = key.scale
  } else if (key.quality) {
    // On garde le type de gamme / d'arpège choisi s'il a déjà la bonne couleur (ex. blues pour un morceau mineur)
    if (overlayType.value === 'arpeggio') {
      const current = ARPEGGIOS.find((a) => a.id === arpeggioId.value)
      if (quality(current) !== key.quality) arpeggioId.value = key.quality === 'minor' ? 'm7' : 'maj7'
    } else {
      const current = SCALES.find((sc) => sc.id === scaleId.value)
      overlayType.value = 'scale'
      if (quality(current) !== key.quality) scaleId.value = key.quality === 'minor' ? 'penta-minor' : 'penta-major'
    }
  }
  keySync.value = { title: track.name, state: syncState() }
}

const syncState = () => [overlayType.value, root.value, scaleId.value, arpeggioId.value].join('|')
// L'indication disparaît dès que la gamme est changée à la main
const keySyncActive = computed(() => keySync.value && keySync.value.state === syncState())

// ---------- Combo ----------
const combo = useCombo({
  scaleKey: computed(() => (pattern.value ? `${overlayType.value}:${root.value}:${pattern.value.id}` : 'none')),
  scaleSize: computed(() => overlay.value.size),
})

// ---------- Notes jouées ----------
const played = shallowRef(null) // { midi, string, fret }
const anchor = ref(null)
const history = ref([])
let historyId = 0
let clearTimer = 0

let lastPosition = null

function registerNote(midi, forcedPosition = null, legato = false) {
  const candidates = findPositions(midi, tuning, frets.value)
  if (!candidates.length) return
  // Slide / legato : la note reste sur la même corde que la précédente
  const sameString = legato && lastPosition && candidates.find((c) => c.string === lastPosition.string)
  const position = forcedPosition ?? sameString ?? estimatePosition(candidates, anchor.value)
  anchor.value = forcedPosition ? { fret: Math.max(1, position.fret), string: position.string } : updateAnchor(anchor.value, position)
  lastPosition = position

  const info = overlay.value.get(pitchClass(midi)) ?? null
  const events = overlay.value.size ? combo.play({ midi, ...position, info, legato }) : []
  const glide = events.some((e) => e.type === 'glide') // note de passage d'un slide : pas une erreur
  played.value = { midi, ...position, glide }

  history.value.unshift({
    id: ++historyId,
    midi,
    ...position,
    info,
    glide,
    outside: overlay.value.size > 0 && !info && !glide,
  })
  if (history.value.length > 24) history.value.length = 24
}

const audio = useAudioInput({
  onNote: (n) => {
    clearTimeout(clearTimer)
    registerNote(n.midi, null, n.legato)
  },
})

// Garde la dernière note affichée un court instant après la fin du son
watch(audio.current, (c) => {
  if (!c && played.value) {
    clearTimeout(clearTimer)
    clearTimer = setTimeout(() => (played.value = null), 700)
  }
})

// Clic sur le manche : simule une note et indique ta position à l'estimateur
function onFretClick({ string, fret, midi }) {
  clearTimeout(clearTimer)
  registerNote(midi, { string, fret })
  clearTimer = setTimeout(() => {
    if (!audio.current.value) played.value = null
  }, 1200)
}

const alternates = computed(() => {
  if (!played.value || !showAlternates.value) return []
  return findPositions(played.value.midi, tuning, frets.value).filter(
    (p) => p.string !== played.value.string || p.fret !== played.value.fret,
  )
})

const playedInfo = computed(() => (played.value ? overlay.value.get(pitchClass(played.value.midi)) : null))

function onDeviceChange(e) {
  audio.setDevice(e.target.value)
}

function toggleAudio() {
  audio.running.value ? audio.stop() : audio.start()
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-anthracite text-neutral-200">
    <!-- ========== Barre latérale ========== -->
    <aside
      class="sticky top-0 flex h-screen shrink-0 flex-col border-r border-white/5 bg-neutral-900/70 backdrop-blur transition-[width] duration-200"
      :class="sidebarOpen ? 'w-80' : 'w-16'"
    >
      <!-- Logo + bouton replier -->
      <div class="flex h-16 shrink-0 items-center border-b border-white/5" :class="sidebarOpen ? 'justify-between px-5' : 'justify-center'">
        <h1 v-if="sidebarOpen" class="text-lg font-black tracking-tight whitespace-nowrap text-white">
          Fretboard <span class="text-copper-400">Live</span>
        </h1>
        <button
          class="rounded-lg p-2 text-neutral-500 transition hover:bg-white/5 hover:text-neutral-200"
          :title="sidebarOpen ? 'Replier les réglages' : 'Déplier les réglages'"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Icon :name="sidebarOpen ? 'collapse' : 'expand'" class="size-5" />
        </button>
      </div>

      <!-- Barre repliée : colonne d'icônes -->
      <nav v-if="!sidebarOpen" class="flex flex-col items-center gap-2 py-4">
        <button
          class="relative flex size-11 items-center justify-center rounded-xl transition"
          :class="audio.running.value ? 'bg-copper-500/15 text-copper-400 hover:bg-copper-500/25' : 'bg-copper-500 text-neutral-950 hover:bg-copper-400'"
          :title="audio.running.value ? 'Arrêter l’écoute' : 'Démarrer l’écoute'"
          @click="toggleAudio"
        >
          <Icon :name="audio.running.value ? 'stop' : 'play'" class="size-5" />
          <span v-if="audio.running.value" class="absolute top-1.5 right-1.5 size-2 animate-pulse rounded-full bg-copper-400" />
        </button>
        <!-- Mini vu-mètre vertical -->
        <div v-if="audio.running.value" class="relative h-16 w-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div class="absolute bottom-0 w-full rounded-full bg-linear-to-t from-copper-500 via-copper-400 to-rose-500" :style="{ height: audio.level.value * 100 + '%' }" />
        </div>
        <div class="my-2 h-px w-8 bg-white/5" />
        <button class="rail-btn" title="Gamme / arpège" @click="sidebarOpen = true">
          <span class="text-xs font-bold text-copper-300">{{ pattern ? NOTE_NAMES[notation][root] : '—' }}</span>
        </button>
        <button class="rail-btn" title="Entrée audio" @click="sidebarOpen = true"><Icon name="mic" class="size-5" /></button>
        <button class="rail-btn" title="Affichage" @click="sidebarOpen = true"><Icon name="sliders" class="size-5" /></button>
      </nav>

      <!-- Barre dépliée : réglages -->
      <div v-else class="flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <!-- Gamme / arpège -->
        <section>
          <h2 class="section-title"><Icon name="music" class="size-4" /> Gamme / arpège</h2>
          <div class="space-y-3">
            <div class="segmented grid-cols-3">
              <button
                v-for="t in [
                  { id: 'scale', label: 'Gamme' },
                  { id: 'arpeggio', label: 'Arpège' },
                  { id: 'none', label: 'Aucun' },
                ]"
                :key="t.id"
                :class="overlayType === t.id ? 'is-active' : ''"
                @click="overlayType = t.id"
              >
                {{ t.label }}
              </button>
            </div>

            <div class="grid grid-cols-6 gap-1">
              <button
                v-for="(n, i) in NOTE_NAMES[notation]"
                :key="i"
                :disabled="overlayType === 'none'"
                class="rounded-md py-1.5 text-xs font-semibold transition disabled:opacity-30"
                :class="root === i ? 'bg-copper-500 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'"
                @click="root = i"
              >
                {{ n }}
              </button>
            </div>

            <select v-if="overlayType === 'scale'" v-model="scaleId" class="field" aria-label="Gamme">
              <option v-for="s in SCALES" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <select v-else-if="overlayType === 'arpeggio'" v-model="arpeggioId" class="field" aria-label="Arpège">
              <option v-for="a in ARPEGGIOS" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>
        </section>

        <!-- Entrée audio -->
        <section>
          <h2 class="section-title">
            <Icon name="mic" class="size-4" /> Entrée audio
            <span class="ml-auto flex items-center gap-1.5 text-[11px] font-normal tracking-normal normal-case" :class="audio.running.value ? 'text-copper-400' : 'text-neutral-600'">
              <span class="size-2 rounded-full" :class="audio.running.value ? 'animate-pulse bg-copper-400' : 'bg-neutral-700'" />
              {{ audio.running.value ? `${audio.sampleRate.value / 1000} kHz` : 'Arrêté' }}
            </span>
          </h2>

          <div class="space-y-3">
            <button
              class="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition"
              :class="audio.running.value ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'bg-copper-500 text-neutral-950 hover:bg-copper-400'"
              @click="toggleAudio"
            >
              <Icon :name="audio.running.value ? 'stop' : 'play'" class="size-4" />
              {{ audio.running.value ? 'Arrêter' : 'Démarrer l’écoute' }}
            </button>

            <label class="block">
              <span class="field-label">Interface</span>
              <select class="field" :value="audio.deviceId.value" @change="onDeviceChange">
                <option v-if="!audio.devices.value.length" value="">Clique sur Démarrer pour voir tes interfaces</option>
                <option v-for="d in audio.devices.value" :key="d.deviceId" :value="d.deviceId">
                  {{ d.label || 'Entrée audio' }}
                </option>
              </select>
            </label>

            <label class="block">
              <span class="field-label">Canal</span>
              <select class="field" :value="audio.channel.value" @change="audio.setChannel($event.target.value)">
                <option value="mix">Toutes les entrées</option>
                <option value="0">Entrée 1</option>
                <option value="1">Entrée 2</option>
              </select>
            </label>

            <label class="block">
              <span class="field-label flex justify-between">
                Sensibilité <span class="tabular-nums">{{ audio.sensitivity.value }} %</span>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                class="w-full accent-copper-400"
                :value="audio.sensitivity.value"
                @input="audio.setSensitivity(Number($event.target.value))"
              />
            </label>

            <!-- Vu-mètre -->
            <div class="relative h-2 overflow-hidden rounded-full bg-neutral-800">
              <div
                class="h-full rounded-full bg-linear-to-r from-copper-500 via-copper-400 to-rose-500 transition-[width] duration-75"
                :style="{ width: audio.level.value * 100 + '%' }"
              />
              <div class="absolute top-0 h-full w-0.5 bg-white/60" :style="{ left: audio.thresholdLevel.value * 100 + '%' }" />
            </div>

            <p v-if="audio.error.value" class="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{{ audio.error.value }}</p>
          </div>
        </section>

        <!-- Affichage -->
        <section>
          <h2 class="section-title"><Icon name="sliders" class="size-4" /> Affichage</h2>
          <div class="space-y-3">
            <div>
              <span class="field-label">Notation</span>
              <div class="segmented grid-cols-2">
                <button
                  v-for="t in [
                    { id: 'fr', label: 'Do Ré Mi' },
                    { id: 'en', label: 'C D E' },
                  ]"
                  :key="t.id"
                  :class="notation === t.id ? 'is-active' : ''"
                  @click="notation = t.id"
                >
                  {{ t.label }}
                </button>
              </div>
            </div>

            <div>
              <span class="field-label">Étiquettes sur le manche</span>
              <div class="segmented grid-cols-2">
                <button
                  v-for="t in [
                    { id: 'note', label: 'Notes' },
                    { id: 'degree', label: 'Degrés' },
                  ]"
                  :key="t.id"
                  :class="labelMode === t.id ? 'is-active' : ''"
                  @click="labelMode = t.id"
                >
                  {{ t.label }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 items-end gap-3">
              <label class="block">
                <span class="field-label">Cases</span>
                <select v-model.number="frets" class="field">
                  <option :value="21">21</option>
                  <option :value="22">22</option>
                  <option :value="24">24</option>
                </select>
              </label>
              <label class="flex cursor-pointer items-center gap-2 pb-2">
                <input v-model="showAlternates" type="checkbox" class="size-4 accent-copper-400" />
                <span class="text-sm text-neutral-300">Autres positions</span>
              </label>
            </div>
          </div>
        </section>
      </div>
    </aside>

    <!-- ========== Contenu principal ========== -->
    <main class="flex h-screen min-w-0 flex-1 flex-col px-6 py-5 lg:px-8">
      <!-- En-tête : gamme courante + note jouée -->
      <header class="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div>
          <div class="text-[11px] font-semibold tracking-widest text-neutral-500 uppercase">
            {{ overlayType === 'arpeggio' ? 'Arpège' : overlayType === 'scale' ? 'Gamme' : 'Manche libre' }}
          </div>
          <h2 class="text-3xl font-black tracking-tight text-white">{{ overlayTitle }}</h2>
          <div v-if="keySyncActive" class="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
            <span class="size-2 rounded-full bg-[#1DB954]" />
            Réglé d'après « <span class="max-w-80 truncate text-neutral-300">{{ keySync.title }}</span> »
          </div>
          <div v-if="pattern" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="i in pattern.intervals"
              :key="i"
              class="rounded-md px-2 py-0.5 text-xs font-semibold"
              :class="i === 0 ? 'bg-copper-500/20 text-copper-300' : 'bg-neutral-800 text-neutral-300'"
            >
              {{ NOTE_NAMES[notation][(root + i) % 12] }}
              <span class="text-neutral-500">{{ overlay.get((root + i) % 12)?.degree }}</span>
            </span>
          </div>
        </div>

        <div class="flex items-center gap-4 rounded-2xl bg-neutral-900 py-3 pr-3 pl-5 ring-1 ring-white/5">
          <div class="text-right">
            <div class="text-[11px] tracking-widest text-neutral-500 uppercase">Note jouée</div>
            <div class="text-sm" :class="!played ? 'text-neutral-600' : playedInfo ? 'text-copper-300' : overlay.size && !played.glide ? 'text-rose-400' : 'text-neutral-400'">
              <template v-if="!played">en attente</template>
              <template v-else-if="playedInfo">degré {{ playedInfo.degree }} · corde {{ played.string + 1 }}, case {{ played.fret }}</template>
              <template v-else-if="played.glide">note de passage · corde {{ played.string + 1 }}, case {{ played.fret }}</template>
              <template v-else-if="overlay.size">hors gamme · corde {{ played.string + 1 }}, case {{ played.fret }}</template>
              <template v-else>corde {{ played.string + 1 }}, case {{ played.fret }}</template>
            </div>
          </div>
          <div
            class="flex h-16 min-w-24 items-center justify-center rounded-xl px-3 text-3xl font-black transition-colors"
            :class="!played ? 'bg-neutral-800 text-neutral-600' : playedInfo || !overlay.size ? 'bg-copper-500 text-white' : played.glide ? 'bg-neutral-700 text-neutral-300' : 'bg-rose-500 text-white'"
          >
            {{ played ? noteName(played.midi, notation, true) : '—' }}
          </div>
        </div>
      </header>

      <!-- Manche -->
      <Fretboard
        :tuning="tuning"
        :frets="frets"
        :overlay="overlay"
        :notation="notation"
        :label-mode="labelMode"
        :played="played"
        :alternates="alternates"
        :anchor="anchor"
        :heat="pattern ? combo.state.value.mult - 1 : 0"
        :broke-at="combo.brokeAt.value"
        @play="onFretClick"
      />
      <div class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1 text-xs text-neutral-500">
        <div class="flex flex-wrap items-center gap-4">
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-stone-900 ring-2 ring-copper-400" /> Tonique</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-stone-900 ring-1 ring-stone-500" /> Gamme</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-copper-500" /> Jouée</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-rose-500" /> Hors gamme</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full border-2 border-dashed border-copper-300" /> Même note ailleurs</span>
          <span class="flex items-center gap-1.5"><span class="h-3 w-5 rounded-sm bg-white/15" /> Position de la main</span>
        </div>
        <span class="text-neutral-600">Clique sur une case pour indiquer où se trouve ta main.</span>
      </div>

      <!-- Accordeur + historique -->
      <div class="mt-4 grid min-h-0 flex-1 gap-4 overflow-y-auto xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <SpotifyPlayer :suggestion="backingSuggestion" @track-change="onTrackChange" />
        <div class="flex min-h-0 flex-col gap-4">
          <Tuner :midi-float="audio.midiFloat.value" :frequency="audio.frequency.value" :notation="notation" />
          <ComboPanel
            :state="combo.state.value"
            :announcement="combo.announcement.value"
            :floater="combo.floater.value"
            :last-note-at="combo.lastNoteAt.value"
            :decay-ms="combo.decayMs"
            :active="Boolean(pattern)"
            :items="history"
            :notation="notation"
            @reset="combo.reset()"
            @clear="history = []"
          />
        </div>
      </div>
    </main>
  </div>
</template>

<style>
@reference "./style.css";

.field {
  @apply w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 ring-1 ring-white/5 outline-none focus:ring-copper-400/60;
}
.field-label {
  @apply mb-1 block text-xs text-neutral-500;
}
.section-title {
  @apply mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-neutral-400 uppercase;
}
.segmented {
  @apply grid gap-1 rounded-xl bg-neutral-800 p-1;
}
.segmented > button {
  @apply rounded-lg py-1.5 text-sm font-medium text-neutral-400 transition hover:text-neutral-200;
}
.segmented > button.is-active {
  @apply bg-neutral-200 text-neutral-950;
}
.rail-btn {
  @apply flex size-11 items-center justify-center rounded-xl text-neutral-400 transition hover:bg-white/5 hover:text-neutral-100;
}
</style>
