import { ref, shallowRef, onBeforeUnmount } from 'vue'
import { getAccessToken, handleRedirect, hasToken, isConfigured, login, logout as clearToken } from '../lib/spotifyAuth'

const API = 'https://api.spotify.com/v1'

let sdkPromise = null
function loadSdk() {
  sdkPromise ??= new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify)
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.onerror = () => reject(new Error('Impossible de charger le lecteur Spotify.'))
    document.head.appendChild(script)
  })
  return sdkPromise
}

/**
 * Lecteur Spotify intégré à la page (Web Playback SDK, compte Premium requis).
 * La page devient un appareil « Fretboard Live » visible dans Spotify Connect.
 */
export function useSpotify() {
  const loggedIn = ref(isConfigured && hasToken())
  const user = shallowRef(null)
  const ready = ref(false) // l'appareil est enregistré auprès de Spotify
  const error = ref('')

  const track = shallowRef(null) // { name, artists, image, uri }
  const paused = ref(true)
  const position = ref(0) // ms
  const duration = ref(0) // ms
  const volume = ref(Number(localStorage.getItem('fb.spotify.volume') || 0.6))

  let player = null
  let deviceId = null
  let lastState = null
  let lastStateAt = 0

  // Le SDK ne notifie pas la progression : on l'extrapole entre deux événements
  const ticker = setInterval(() => {
    if (lastState && !paused.value) position.value = Math.min(duration.value, lastState.position + performance.now() - lastStateAt)
  }, 250)

  async function api(path, { method = 'GET', body } = {}) {
    const token = await getAccessToken()
    if (!token) {
      loggedIn.value = false
      throw new Error('Session Spotify expirée, reconnecte-toi.')
    }
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) throw new Error(data?.error?.message || `Erreur Spotify (${res.status})`)
    return data
  }

  async function initPlayer() {
    const Spotify = await loadSdk()
    player = new Spotify.Player({
      name: 'Fretboard Live',
      volume: volume.value,
      getOAuthToken: (cb) => getAccessToken().then((t) => t && cb(t)),
    })

    player.addListener('ready', ({ device_id }) => {
      deviceId = device_id
      ready.value = true
    })
    player.addListener('not_ready', () => (ready.value = false))
    player.addListener('player_state_changed', (state) => {
      lastState = state
      lastStateAt = performance.now()
      if (!state) {
        track.value = null
        paused.value = true
        return
      }
      const t = state.track_window.current_track
      track.value = {
        name: t.name,
        uri: t.uri,
        artists: t.artists.map((a) => a.name).join(', '),
        image: t.album.images.at(-1)?.url ?? t.album.images[0]?.url,
      }
      paused.value = state.paused
      position.value = state.position
      duration.value = state.duration
    })
    player.addListener('initialization_error', ({ message }) => (error.value = `Lecteur indisponible : ${message}`))
    player.addListener('authentication_error', () => {
      error.value = 'Authentification Spotify échouée, reconnecte-toi.'
      logout()
    })
    player.addListener('account_error', () => (error.value = 'Un compte Spotify Premium est nécessaire pour la lecture.'))
    player.addListener('playback_error', ({ message }) => (error.value = `Lecture impossible : ${message}`))

    await player.connect()
  }

  async function init() {
    if (!isConfigured) return
    try {
      await handleRedirect()
      loggedIn.value = hasToken()
      if (!loggedIn.value) return
      user.value = await api('/me')
      await initPlayer()
    } catch (e) {
      error.value = e.message
    }
  }

  function logout() {
    player?.disconnect()
    player = null
    deviceId = null
    ready.value = false
    track.value = null
    user.value = null
    clearToken()
    loggedIn.value = false
  }

  /** Lance un morceau (uri) ou une playlist / un album (contextUri) sur le lecteur de la page. */
  async function play({ uri, contextUri }) {
    error.value = ''
    // Doit être appelé pendant le clic, sinon le navigateur bloque la lecture automatique
    player?.activateElement()
    if (!deviceId) {
      error.value = 'Le lecteur n’est pas encore prêt.'
      return
    }
    try {
      await api(`/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: contextUri ? { context_uri: contextUri } : { uris: [uri] },
      })
    } catch (e) {
      error.value = e.message
    }
  }

  async function search(query) {
    const params = new URLSearchParams({ q: query, type: 'track,playlist', limit: '10' })
    const data = await api(`/search?${params}`)
    return {
      tracks: data.tracks?.items.filter(Boolean) ?? [],
      // Spotify renvoie parfois des entrées nulles dans les playlists
      playlists: data.playlists?.items.filter(Boolean) ?? [],
    }
  }

  async function myPlaylists() {
    const data = await api('/me/playlists?limit=50')
    return data.items.filter(Boolean)
  }

  const togglePlay = () => player?.togglePlay()
  const next = () => player?.nextTrack()
  const previous = () => player?.previousTrack()
  function seek(ms) {
    position.value = ms
    player?.seek(ms)
  }
  function setVolume(v) {
    volume.value = v
    localStorage.setItem('fb.spotify.volume', String(v))
    player?.setVolume(v)
  }

  init()

  onBeforeUnmount(() => {
    clearInterval(ticker)
    player?.disconnect()
  })

  return {
    isConfigured,
    loggedIn,
    user,
    ready,
    error,
    track,
    paused,
    position,
    duration,
    volume,
    login,
    logout,
    play,
    search,
    myPlaylists,
    togglePlay,
    next,
    previous,
    seek,
    setVolume,
  }
}
