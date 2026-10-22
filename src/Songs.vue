<script setup>
// Page Morceaux : bibliothèque de tablatures Guitar Pro importées depuis l'ordinateur (voir lib/songLibrary.js)
import { computed, defineAsyncComponent, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import Icon from './components/Icon.vue'
import { ACCEPT, deleteSong, importSong, listSongs } from './lib/songLibrary'
import { createSongPlayer, songTimeline } from './lib/songPlayer'
// Mode Jouer (Three.js, alphaTab) : chargé seulement à l'ouverture
const PlayView = defineAsyncComponent(() => import('./components/play/PlayView.vue'))

const songs = ref([])
const loading = ref(true)
const importing = ref(0) // fichiers en cours de lecture
const errors = ref([])
const dragging = ref(false)
const confirmId = ref(null) // morceau dont la suppression attend confirmation
const fileInput = ref(null)
const lastAdded = ref(new Set())

onMounted(async () => {
  try {
    songs.value = await listSongs()
  } catch {
    errors.value = ['Le stockage du navigateur est indisponible (navigation privée ?) : les morceaux ne peuvent pas être gardés.']
  }
  loading.value = false
})

const isGuitarPro = (f) => ACCEPT.split(',').some((ext) => f.name.toLowerCase().endsWith(ext))

async function addFiles(fileList) {
  errors.value = []
  const files = [...fileList]
  const rejected = files.filter((f) => !isGuitarPro(f))
  if (rejected.length) errors.value.push(`Ignoré (pas un fichier Guitar Pro) : ${rejected.map((f) => f.name).join(', ')}`)
  const added = new Set()
  for (const f of files.filter(isGuitarPro)) {
    importing.value++
    try {
      const song = await importSong(f)
      songs.value = [song, ...songs.value]
      added.add(song.id)
    } catch (e) {
      errors.value.push(e.message)
    } finally {
      importing.value--
    }
  }
  lastAdded.value = added
}

function onPick(e) {
  addFiles(e.target.files)
  e.target.value = '' // permet de réimporter le même fichier
}
// Glisser-déposer n'importe où sur la page
let dragDepth = 0
function onDragEnter(e) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  dragging.value = true
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}
function onDrop(e) {
  dragDepth = 0
  dragging.value = false
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files)
}

// ---------- Écoute de la batterie (synthétisée) ----------
let player = null
let ticker = 0
const listening = ref(null) // { id, elapsed, duration, loading }
const hasDrums = (song) => song.tracks.some((t) => t.percussion && t.notes > 0)

function stopDrums() {
  player?.destroy()
  player = null
  clearInterval(ticker)
  listening.value = null
}
async function toggleDrums(song) {
  if (listening.value?.id === song.id) return stopDrums()
  stopDrums()
  listening.value = { id: song.id, elapsed: 0, duration: 0, loading: true }
  try {
    const timeline = await songTimeline(song.data)
    if (listening.value?.id !== song.id) return // une autre écoute a été lancée entre-temps
    player = createSongPlayer(timeline, { onEnd: stopDrums })
    await player.play()
    listening.value = { id: song.id, elapsed: 0, duration: timeline.duration, loading: false }
    ticker = setInterval(() => listening.value && (listening.value.elapsed = player.position()), 200)
  } catch {
    stopDrums()
    errors.value = [`Impossible de lire la batterie de « ${song.title} ».`]
  }
}
onDeactivated(stopDrums)

// ---------- Jouer (autoroute de notes) ----------
const playing = ref(null) // morceau ouvert en mode Jouer
function play(song) {
  stopDrums()
  playing.value = song
}
onBeforeUnmount(stopDrums)

async function remove(song) {
  if (confirmId.value !== song.id) return void (confirmId.value = song.id)
  if (listening.value?.id === song.id) stopDrums()
  await deleteSong(song.id)
  songs.value = songs.value.filter((s) => s.id !== song.id)
  confirmId.value = null
}

const duration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const trackKind = (t) => (t.percussion ? 'batterie' : t.strings <= 5 ? `basse ${t.strings} cordes` : `${t.strings} cordes`)
const playable = (song) => song.tracks.filter((t) => !t.percussion && t.notes > 0)
const totalSize = computed(() => songs.value.reduce((n, s) => n + s.size, 0))
</script>

<template>
  <div class="relative min-h-[calc(100vh-3.5rem)] bg-anthracite text-neutral-200" @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
    <div class="mx-auto max-w-5xl px-4 pt-8 pb-20 sm:px-8">
      <!-- En-tête -->
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="text-xs font-bold tracking-[0.25em] text-copper-400 uppercase">Tablatures</div>
          <h2 class="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Mes morceaux</h2>
          <p class="mt-2 max-w-xl text-neutral-400">Importe tes fichiers Guitar Pro pour les jouer en défilement, comme dans Rocksmith.</p>
        </div>
        <button class="import-btn" :disabled="importing > 0" @click="fileInput.click()">
          <Icon name="upload" class="size-5" />
          {{ importing ? 'Lecture…' : 'Importer des fichiers' }}
        </button>
        <input ref="fileInput" type="file" :accept="ACCEPT" multiple class="hidden" @change="onPick" />
      </header>

      <p class="mt-4 flex items-center gap-2 text-xs text-neutral-500">
        <Icon name="lock" class="size-4" />
        Tes fichiers restent dans ce navigateur : ils ne sont jamais envoyés sur Internet.
        <span v-if="songs.length" class="ml-auto tabular-nums">{{ songs.length }} morceau{{ songs.length > 1 ? 'x' : '' }} · {{ (totalSize / 1024).toFixed(0) }} Ko</span>
      </p>

      <!-- Erreurs d'import -->
      <div v-if="errors.length" class="mt-4 space-y-1 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200 ring-1 ring-rose-400/30">
        <p v-for="(e, i) in errors" :key="i">{{ e }}</p>
      </div>

      <!-- Bibliothèque vide : grande zone de dépôt -->
      <button
        v-if="!loading && !songs.length"
        class="drop-zone mt-8 flex w-full flex-col items-center justify-center gap-3 rounded-3xl px-6 py-16 text-center"
        @click="fileInput.click()"
      >
        <span class="flex size-16 items-center justify-center rounded-2xl bg-copper-500/15 text-copper-300"><Icon name="upload" class="size-8" /></span>
        <span class="text-lg font-bold text-white">Glisse tes fichiers Guitar Pro ici</span>
        <span class="text-sm text-neutral-400">ou clique pour les choisir sur ton ordinateur</span>
        <span class="mt-2 text-xs text-neutral-500">.gp (Guitar Pro 7 et 8) · .gpx (GP 6) · .gp5 · .gp4 · .gp3</span>
      </button>

      <!-- Liste des morceaux -->
      <ul v-else class="mt-6 grid gap-3">
        <li
          v-for="s in songs"
          :key="s.id"
          class="song flex flex-col gap-4 rounded-2xl bg-neutral-900 p-4 ring-1 sm:flex-row sm:items-center sm:p-5"
          :class="lastAdded.has(s.id) ? 'is-new ring-copper-400/50' : 'ring-white/5'"
        >
          <!-- Pochette : initiales du titre -->
          <div class="cover flex size-14 shrink-0 items-center justify-center rounded-xl text-lg font-black text-white">{{ s.title.slice(0, 2).toUpperCase() }}</div>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <h3 class="truncate text-lg font-bold text-white">{{ s.title }}</h3>
              <span v-if="s.artist" class="truncate text-sm text-neutral-400">{{ s.artist }}<template v-if="s.album"> · {{ s.album }}</template></span>
            </div>
            <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-500 tabular-nums">
              <span v-if="s.tempo">{{ s.tempo }} BPM</span>
              <span>≈ {{ duration(s.seconds) }}</span>
              <span>{{ s.bars }} mesures</span>
              <span class="truncate" :title="s.file">{{ s.file }}</span>
            </div>
            <div class="mt-2.5 flex flex-wrap gap-1.5">
              <span
                v-for="t in s.tracks"
                :key="t.index"
                class="rounded-md px-2 py-0.5 text-xs font-semibold"
                :class="t.percussion || !t.notes ? 'bg-neutral-800/60 text-neutral-500' : 'bg-copper-500/15 text-copper-200'"
                :title="`${trackKind(t)} · ${t.notes} notes`"
              >
                {{ t.name }} <span class="font-normal opacity-60">{{ trackKind(t) }}</span>
              </span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
            <div class="flex gap-2">
              <button v-if="hasDrums(s)" class="play-btn" :class="{ 'is-on': listening?.id === s.id }" :title="listening?.id === s.id ? 'Arrêter' : 'Écouter la batterie du morceau (synthétisée)'" @click="toggleDrums(s)">
                <Icon :name="listening?.id === s.id ? 'stop' : 'drum'" class="size-4" />
                <template v-if="listening?.id === s.id">{{ listening.loading ? '…' : `${duration(Math.floor(listening.elapsed))} / ${duration(Math.round(listening.duration))}` }}</template>
                <template v-else>Batterie</template>
              </button>
              <button class="play-btn is-play" :disabled="!playable(s).length" :title="playable(s).length ? 'Jouer ce morceau en défilement' : 'Aucune piste de guitare dans ce fichier'" @click="play(s)">
                <Icon name="play" class="size-4" /> Jouer
              </button>
            </div>
            <button
              class="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
              :class="confirmId === s.id ? 'bg-rose-500 text-white' : 'text-neutral-500 hover:bg-white/5 hover:text-rose-300'"
              @click="remove(s)"
              @blur="confirmId === s.id && (confirmId = null)"
            >
              {{ confirmId === s.id ? 'Confirmer la suppression' : 'Supprimer' }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <PlayView v-if="playing" :song="playing" @close="playing = null" />

    <!-- Fichier glissé au-dessus de la page -->
    <div v-if="dragging" class="pointer-events-none fixed inset-x-0 top-14 bottom-0 z-20 flex items-center justify-center bg-anthracite/80 backdrop-blur-sm">
      <div class="drop-zone is-over flex flex-col items-center gap-3 rounded-3xl px-16 py-12">
        <Icon name="upload" class="size-10 text-copper-300" />
        <span class="text-lg font-bold text-white">Dépose pour importer</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.import-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(180deg, var(--color-copper-400), var(--color-copper-600));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    0 6px 20px -8px color-mix(in srgb, var(--color-copper-500) 70%, transparent);
  transition:
    transform 0.15s,
    filter 0.15s;
}
.import-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.import-btn:disabled {
  opacity: 0.6;
}
.drop-zone {
  border: 2px dashed rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.02);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.drop-zone:hover,
.drop-zone.is-over {
  border-color: var(--color-copper-400);
  background: color-mix(in srgb, var(--color-copper-500) 8%, transparent);
}
.cover {
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.25), transparent 60%),
    linear-gradient(135deg, var(--color-copper-500), #3b2a20);
}
.play-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  color: #e7e5e4;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.play-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.play-btn.is-play:not(:disabled) {
  color: #fff;
  background: linear-gradient(180deg, var(--color-copper-400), var(--color-copper-600));
  box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--color-copper-500) 80%, transparent);
}
.play-btn.is-on {
  color: #fff;
  background: var(--color-copper-500);
  box-shadow: none;
  font-variant-numeric: tabular-nums;
}
.play-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.song.is-new {
  animation: song-in 0.5s ease both;
}
@keyframes song-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}
</style>
