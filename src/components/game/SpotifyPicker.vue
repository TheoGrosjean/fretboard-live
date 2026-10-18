<script setup>
// Choix d'un morceau Spotify pour le mode jeu « Morceau » : recherche ou playlists de l'utilisateur
import { onMounted, ref } from 'vue'

const props = defineProps({
  sp: { type: Object, required: true }, // contrôles du lecteur (voir useSpotify)
  suggestion: { type: String, default: 'guitar backing track' }, // recherche proposée selon la gamme
})
const emit = defineEmits(['pick', 'close'])

const tab = ref('search') // 'search' | 'playlists'
const query = ref(props.suggestion)
const tracks = ref([])
const playlists = ref([])
const opened = ref(null) // { playlist, tracks, loading, locked }
const loading = ref(false)
const error = ref('')

const cover = (images) => images?.at(-1)?.url ?? images?.[0]?.url
const artists = (t) => t.artists?.map((a) => a.name).join(', ') ?? ''
const formatTime = (ms) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function load(fn) {
  loading.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const runSearch = () => {
  if (!query.value.trim()) return
  tab.value = 'search'
  opened.value = null
  load(async () => (tracks.value = (await props.sp.search(query.value)).tracks))
}
function showPlaylists() {
  tab.value = 'playlists'
  opened.value = null
  if (!playlists.value.length) load(async () => (playlists.value = await props.sp.myPlaylists()))
}
async function openPlaylist(p) {
  opened.value = { playlist: p, tracks: [], loading: true, locked: false }
  let list = []
  let locked = false
  try {
    list = await props.sp.playlistTracks(p.id)
  } catch {
    locked = true // Spotify ne sert que les playlists que tu possèdes
  }
  if (opened.value?.playlist.id === p.id) opened.value = { playlist: p, tracks: list, loading: false, locked }
}

function pick(t) {
  emit('pick', { uri: t.uri, name: t.name, artists: artists(t), image: cover(t.album?.images), duration: t.duration_ms })
}

onMounted(runSearch)
</script>

<template>
  <div class="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" @click.self="emit('close')">
    <div class="picker flex max-h-full w-full max-w-2xl flex-col rounded-2xl p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-sm font-black tracking-[0.2em] uppercase"><span class="size-2.5 rounded-full bg-[#1DB954]" /> Choisis ton morceau</h2>
        <button class="text-xs font-semibold text-neutral-400 hover:text-white" @click="emit('close')">Fermer</button>
      </div>

      <form class="flex gap-2" @submit.prevent="runSearch">
        <input v-model="query" class="game-input flex-1" placeholder="Titre, artiste, « A minor backing track »…" autofocus />
        <button class="rounded-lg bg-[#1DB954] px-4 text-sm font-bold text-black hover:brightness-110">Chercher</button>
      </form>
      <div class="mt-3 flex gap-2 text-xs">
        <button class="tab" :class="{ on: tab === 'search' }" @click="tab = 'search'">Recherche</button>
        <button class="tab" :class="{ on: tab === 'playlists' }" @click="showPlaylists">Mes playlists</button>
      </div>

      <div class="mt-3 min-h-0 flex-1 overflow-y-auto">
        <p v-if="error" class="py-6 text-center text-sm text-rose-300">{{ error }}</p>
        <p v-else-if="loading" class="py-6 text-center text-sm text-neutral-500">Chargement…</p>

        <!-- Morceaux d'une playlist -->
        <template v-else-if="opened">
          <button class="mb-2 text-xs font-semibold text-neutral-400 hover:text-white" @click="opened = null">← {{ opened.playlist.name }}</button>
          <p v-if="opened.loading" class="py-6 text-center text-sm text-neutral-500">Chargement…</p>
          <p v-else-if="opened.locked" class="py-6 text-center text-sm text-neutral-500">Spotify ne donne accès qu'au contenu des playlists que tu as créées.</p>
          <button v-for="t in opened.tracks" :key="t.uri" class="row" @click="pick(t)">
            <img v-if="cover(t.album?.images)" :src="cover(t.album.images)" alt="" class="size-10 rounded" />
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate text-sm font-semibold">{{ t.name }}</span>
              <span class="block truncate text-xs text-neutral-400">{{ artists(t) }}</span>
            </span>
            <span class="text-xs text-neutral-500 tabular-nums">{{ formatTime(t.duration_ms) }}</span>
          </button>
        </template>

        <!-- Playlists -->
        <template v-else-if="tab === 'playlists'">
          <p v-if="!playlists.length" class="py-6 text-center text-sm text-neutral-500">Aucune playlist.</p>
          <button v-for="p in playlists" :key="p.id" class="row" @click="openPlaylist(p)">
            <img v-if="cover(p.images)" :src="cover(p.images)" alt="" class="size-10 rounded" />
            <span class="min-w-0 flex-1 truncate text-left text-sm font-semibold">{{ p.name }}</span>
            <span class="text-xs text-neutral-500">›</span>
          </button>
        </template>

        <!-- Résultats de recherche -->
        <template v-else>
          <p v-if="!tracks.length" class="py-6 text-center text-sm text-neutral-500">Aucun morceau trouvé.</p>
          <button v-for="t in tracks" :key="t.uri" class="row" @click="pick(t)">
            <img v-if="cover(t.album?.images)" :src="cover(t.album.images)" alt="" class="size-10 rounded" />
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate text-sm font-semibold">{{ t.name }}</span>
              <span class="block truncate text-xs text-neutral-400">{{ artists(t) }}</span>
            </span>
            <span class="text-xs text-neutral-500 tabular-nums">{{ formatTime(t.duration_ms) }}</span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker {
  background: #141211;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 30px 80px -10px rgba(0, 0, 0, 0.9);
}
.game-input {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.game-input:focus {
  box-shadow: inset 0 0 0 2px #1db954;
}
.tab {
  border-radius: 999px;
  padding: 4px 12px;
  font-weight: 700;
  color: #a8a29e;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.tab.on {
  background: #fafaf9;
  color: #1c1917;
  box-shadow: none;
}
.row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  border-radius: 10px;
  padding: 6px 8px;
  transition: background 0.12s;
}
.row:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
