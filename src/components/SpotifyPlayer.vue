<script setup>
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useSpotify } from '../composables/useSpotify'
import { redirectUri } from '../lib/spotifyAuth'

const props = defineProps({
  suggestion: { type: String, default: 'guitar backing track' }, // recherche proposée selon la gamme choisie
})

const emit = defineEmits(['track-change', 'track-start', 'track-end'])

const sp = useSpotify()
// Contrôles du lecteur, pour le mode jeu « Morceau »
defineExpose({ sp })

// Adapter la gamme du manche au morceau lancé (tonalité lue dans le titre)
const followKey = ref(localStorage.getItem('fb.spotify.followKey') !== 'false')
watch(followKey, (v) => localStorage.setItem('fb.spotify.followKey', String(v)))
watch(
  () => sp.track.value?.uri,
  (uri) => {
    if (!uri) return
    emit('track-start', sp.track.value)
    if (followKey.value) emit('track-change', sp.track.value)
  },
)
// Morceau joué jusqu'au bout (pour le finisher)
watch(sp.ended, (e) => e && emit('track-end', e))

const tab = ref('search') // 'search' | 'playlists'
const query = ref('')
const results = ref({ tracks: [], playlists: [] })
const playlists = ref([])
const loading = ref(false)

async function runSearch(q = query.value) {
  if (!q.trim()) return
  query.value = q
  tab.value = 'search'
  opened.value = null
  loading.value = true
  try {
    results.value = await sp.search(q)
  } catch (e) {
    sp.error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadPlaylists() {
  tab.value = 'playlists'
  if (playlists.value.length) return
  loading.value = true
  try {
    playlists.value = await sp.myPlaylists()
  } catch (e) {
    sp.error.value = e.message
  } finally {
    loading.value = false
  }
}

// Playlist ouverte : liste de ses morceaux
const opened = ref(null) // { playlist, tracks, loading, locked }
async function openPlaylist(p) {
  opened.value = { playlist: p, tracks: [], loading: true, locked: false }
  let tracks = []
  let locked = false
  try {
    tracks = await sp.playlistTracks(p.id)
  } catch {
    locked = true // contenu refusé par Spotify (playlist d'un autre compte) : on peut quand même la lancer
  }
  if (opened.value?.playlist.id === p.id) opened.value = { playlist: p, tracks, loading: false, locked }
}
watch(tab, () => (opened.value = null))

// Première recherche automatique dès que le lecteur est prêt
watch(sp.ready, (r) => r && !query.value && runSearch(props.suggestion), { immediate: true })

const formatTime = (ms) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const cover = (images) => images?.at(-1)?.url ?? images?.[0]?.url
</script>

<template>
  <section class="flex min-h-0 flex-col rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5">
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="flex items-center gap-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
        <span class="size-2.5 rounded-full bg-[#1DB954]" /> Backing tracks
      </h2>
      <div v-if="sp.loggedIn.value" class="flex items-center gap-3 text-xs text-neutral-500">
        <span v-if="sp.user.value" class="truncate">{{ sp.user.value.display_name }}</span>
        <button class="hover:text-neutral-200" @click="sp.logout()">Déconnexion</button>
      </div>
    </div>

    <!-- App Spotify non configurée -->
    <div v-if="!sp.isConfigured" class="space-y-2 text-sm text-neutral-400">
      <p>Pour connecter ton compte Spotify (Premium) :</p>
      <ol class="list-decimal space-y-1 pl-5 text-neutral-500">
        <li>Crée une app sur <a href="https://developer.spotify.com/dashboard" target="_blank" class="text-[#1DB954] hover:underline">developer.spotify.com</a> (cocher Web API et Web Playback SDK).</li>
        <li>Ajoute l'URI de redirection <code class="rounded bg-neutral-800 px-1 text-neutral-300">{{ redirectUri }}</code></li>
        <li>Copie le Client ID dans <code class="rounded bg-neutral-800 px-1 text-neutral-300">.env.local</code> : <code class="rounded bg-neutral-800 px-1 text-neutral-300">VITE_SPOTIFY_CLIENT_ID=…</code> puis relance le serveur.</li>
      </ol>
    </div>

    <!-- Non connecté -->
    <div v-else-if="!sp.loggedIn.value" class="flex flex-col items-center gap-3 py-6 text-center">
      <p class="text-sm text-neutral-400">Lance des backing tracks depuis ton compte Spotify sans quitter la page.</p>
      <button class="rounded-full bg-[#1DB954] px-6 py-2.5 font-bold text-neutral-950 transition hover:bg-[#1ed760]" @click="sp.login()">
        Se connecter à Spotify
      </button>
    </div>

    <!-- Connecté -->
    <template v-else>
      <!-- Lecture en cours -->
      <div class="rounded-xl bg-neutral-950/60 p-3 ring-1 ring-white/5">
        <div class="flex items-center gap-3">
          <img v-if="sp.track.value?.image" :src="sp.track.value.image" alt="" class="size-14 shrink-0 rounded-md object-cover" />
          <div v-else class="flex size-14 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-600">
            <Icon name="music" class="size-6" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold text-neutral-100">{{ sp.track.value?.name ?? (sp.ready.value ? 'Choisis un morceau' : 'Connexion au lecteur…') }}</div>
            <div class="truncate text-sm text-neutral-500">{{ sp.track.value?.artists ?? '' }}</div>
          </div>
          <div class="flex items-center gap-1">
            <button class="ctrl" title="Précédent" :disabled="!sp.track.value" @click="sp.previous()"><Icon name="previous" class="size-5" /></button>
            <button
              class="flex size-11 items-center justify-center rounded-full bg-[#1DB954] text-neutral-950 transition hover:scale-105 disabled:opacity-30"
              :title="sp.paused.value ? 'Lecture' : 'Pause'"
              :disabled="!sp.track.value"
              @click="sp.togglePlay()"
            >
              <Icon :name="sp.paused.value ? 'play' : 'pause'" class="size-5" />
            </button>
            <button class="ctrl" title="Suivant" :disabled="!sp.track.value" @click="sp.next()"><Icon name="next" class="size-5" /></button>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-2 text-[11px] text-neutral-500 tabular-nums">
          <span class="w-9 text-right">{{ formatTime(sp.position.value) }}</span>
          <input
            type="range"
            min="0"
            :max="sp.duration.value || 1"
            :value="sp.position.value"
            :disabled="!sp.track.value"
            class="flex-1 accent-[#1DB954]"
            aria-label="Position"
            @change="sp.seek(Number($event.target.value))"
          />
          <span class="w-9">{{ formatTime(sp.duration.value) }}</span>
          <Icon name="volume" class="ml-2 size-4 shrink-0" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="sp.volume.value"
            class="w-20 accent-[#1DB954]"
            aria-label="Volume"
            @input="sp.setVolume(Number($event.target.value))"
          />
        </div>
      </div>

      <label class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-neutral-400">
        <input v-model="followKey" type="checkbox" class="size-4 accent-copper-400" />
        Adapter la gamme au morceau (d'après son titre)
      </label>

      <!-- Recherche / playlists -->
      <div class="mt-4 flex items-center gap-2">
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-neutral-800 p-1 text-sm">
          <button class="rounded-lg px-3 py-1 font-medium transition" :class="tab === 'search' ? 'bg-neutral-200 text-neutral-950' : 'text-neutral-400 hover:text-neutral-200'" @click="tab = 'search'">
            Recherche
          </button>
          <button class="rounded-lg px-3 py-1 font-medium transition" :class="tab === 'playlists' ? 'bg-neutral-200 text-neutral-950' : 'text-neutral-400 hover:text-neutral-200'" @click="loadPlaylists">
            Mes playlists
          </button>
        </div>
        <form v-if="tab === 'search'" class="relative flex-1" @submit.prevent="runSearch()">
          <Icon name="search" class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" />
          <input v-model="query" type="search" placeholder="Rechercher un backing track…" class="w-full rounded-lg bg-neutral-800 py-2 pr-3 pl-9 text-sm text-neutral-200 ring-1 ring-white/5 outline-none focus:ring-[#1DB954]/60" />
        </form>
      </div>
      <button v-if="tab === 'search' && query !== suggestion" class="mt-2 self-start rounded-full bg-[#1DB954]/10 px-3 py-1 text-xs text-[#1DB954] hover:bg-[#1DB954]/20" @click="runSearch(suggestion)">
        Suggestion : {{ suggestion }}
      </button>

      <!-- Playlist ouverte -->
      <div v-if="opened" class="mt-3 flex min-h-32 flex-1 flex-col">
        <div class="flex items-center gap-3 border-b border-white/5 pb-3">
          <button class="ctrl shrink-0" title="Retour" @click="opened = null"><Icon name="collapse" class="size-5" /></button>
          <img v-if="cover(opened.playlist.images)" :src="cover(opened.playlist.images)" alt="" class="size-12 shrink-0 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold text-neutral-100">{{ opened.playlist.name }}</div>
            <div class="truncate text-xs text-neutral-500">
              {{ opened.loading ? 'Chargement…' : opened.locked ? 'Playlist' : `${opened.tracks.length} morceaux` }}<template v-if="opened.playlist.owner?.display_name"> · {{ opened.playlist.owner.display_name }}</template>
            </div>
          </div>
          <button
            class="flex shrink-0 items-center gap-1.5 rounded-full bg-[#1DB954] px-4 py-1.5 text-sm font-bold text-neutral-950 transition hover:bg-[#1ed760]"
            @click="sp.play({ contextUri: opened.playlist.uri })"
          >
            <Icon name="play" class="size-4" /> Tout lire
          </button>
        </div>
        <ul class="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          <li v-for="(t, i) in opened.tracks" :key="t.uri + i">
            <button class="result" :class="sp.track.value?.uri === t.uri ? 'bg-[#1DB954]/10' : ''" @click="sp.play({ contextUri: opened.playlist.uri, uri: t.uri })">
              <span class="w-5 shrink-0 text-right text-xs text-neutral-600 tabular-nums">{{ i + 1 }}</span>
              <img v-if="cover(t.album?.images)" :src="cover(t.album.images)" alt="" class="size-10 rounded object-cover" />
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm" :class="sp.track.value?.uri === t.uri ? 'text-[#1DB954]' : 'text-neutral-200'">{{ t.name }}</span>
                <span class="block truncate text-xs text-neutral-500">{{ t.artists?.map((a) => a.name).join(', ') }}</span>
              </span>
              <span class="text-xs text-neutral-600 tabular-nums">{{ formatTime(t.duration_ms) }}</span>
            </button>
          </li>
          <li v-if="opened.locked" class="px-4 py-6 text-center text-sm text-neutral-500">
            Spotify ne laisse voir le contenu que de tes propres playlists.<br />
            Tu peux quand même la lancer avec <span class="text-[#1DB954]">Tout lire</span>.
          </li>
          <li v-else-if="!opened.loading && !opened.tracks.length" class="py-4 text-center text-sm text-neutral-600">Aucun morceau lisible dans cette playlist.</li>
        </ul>
      </div>

      <ul v-else class="mt-3 min-h-32 flex-1 space-y-1 overflow-y-auto pr-1">
        <li v-if="loading" class="py-4 text-center text-sm text-neutral-600">Chargement…</li>
        <template v-else-if="tab === 'search'">
          <li v-for="p in results.playlists" :key="p.id">
            <button class="result" @click="openPlaylist(p)">
              <img v-if="cover(p.images)" :src="cover(p.images)" alt="" class="size-10 rounded object-cover" />
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm text-neutral-200">{{ p.name }}</span>
                <span class="block truncate text-xs text-neutral-500">Playlist · {{ p.owner?.display_name }}</span>
              </span>
            </button>
          </li>
          <li v-for="t in results.tracks" :key="t.id">
            <button class="result" :class="sp.track.value?.uri === t.uri ? 'bg-[#1DB954]/10' : ''" @click="sp.play({ uri: t.uri })">
              <img v-if="cover(t.album.images)" :src="cover(t.album.images)" alt="" class="size-10 rounded object-cover" />
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm" :class="sp.track.value?.uri === t.uri ? 'text-[#1DB954]' : 'text-neutral-200'">{{ t.name }}</span>
                <span class="block truncate text-xs text-neutral-500">{{ t.artists.map((a) => a.name).join(', ') }}</span>
              </span>
              <span class="text-xs text-neutral-600 tabular-nums">{{ formatTime(t.duration_ms) }}</span>
            </button>
          </li>
          <li v-if="query && !results.tracks.length && !results.playlists.length" class="py-4 text-center text-sm text-neutral-600">Aucun résultat.</li>
        </template>
        <template v-else>
          <li v-for="p in playlists" :key="p.id">
            <button class="result" @click="openPlaylist(p)">
              <img v-if="cover(p.images)" :src="cover(p.images)" alt="" class="size-10 rounded object-cover" />
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm text-neutral-200">{{ p.name }}</span>
                <span v-if="p.tracks?.total ?? p.items?.total" class="block truncate text-xs text-neutral-500">{{ p.tracks?.total ?? p.items?.total }} morceaux</span>
              </span>
              <Icon name="expand" class="size-4 shrink-0 text-neutral-600" />
            </button>
          </li>
        </template>
      </ul>
    </template>

    <p v-if="sp.error.value" class="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{{ sp.error.value }}</p>
  </section>
</template>

<style scoped>
@reference "../style.css";

.ctrl {
  @apply flex size-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/5 hover:text-neutral-100 disabled:opacity-30;
}
.result {
  @apply flex w-full items-center gap-3 rounded-lg p-1.5 transition hover:bg-white/5;
}
</style>
