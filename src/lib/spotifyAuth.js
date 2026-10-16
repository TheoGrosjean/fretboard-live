/**
 * Connexion Spotify via OAuth « Authorization Code + PKCE » : aucun secret n'est
 * nécessaire côté navigateur, seulement le Client ID public de l'app.
 */
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID
// Racine du site : http://127.0.0.1:5173/ en dev, https://<pseudo>.github.io/fretboard-live/ en ligne
const REDIRECT_URI = `${location.origin}${import.meta.env.BASE_URL}`
const SCOPES = [
  'streaming', // Web Playback SDK
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ')

const TOKEN_KEY = 'fb.spotify.token'
const VERIFIER_KEY = 'fb.spotify.verifier'

export const isConfigured = Boolean(CLIENT_ID)
export const redirectUri = REDIRECT_URI

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join('')
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function readToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY))
  } catch {
    return null
  }
}

function saveToken(data, previous = null) {
  const token = {
    access: data.access_token,
    // Spotify ne renvoie pas toujours un nouveau refresh token
    refresh: data.refresh_token ?? previous?.refresh,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
  return token
}

async function requestToken(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  })
  if (!res.ok) throw new Error(`Spotify a refusé la connexion (${res.status})`)
  return res.json()
}

export const hasToken = () => Boolean(readToken())

export async function login() {
  const verifier = randomString(64)
  localStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
  })
  location.assign(`https://accounts.spotify.com/authorize?${params}`)
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
}

/** À appeler au chargement : échange le code reçu au retour de Spotify contre un jeton. */
export async function handleRedirect() {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (!code && !error) return
  history.replaceState(null, '', location.pathname)
  if (error) throw new Error(error === 'access_denied' ? 'Connexion Spotify annulée.' : `Erreur Spotify : ${error}`)

  const verifier = localStorage.getItem(VERIFIER_KEY)
  localStorage.removeItem(VERIFIER_KEY)
  const data = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })
  saveToken(data)
}

let refreshing = null

/** Jeton d'accès valide (rafraîchi si nécessaire), ou null si la session est perdue. */
export async function getAccessToken() {
  const token = readToken()
  if (!token) return null
  if (Date.now() < token.expiresAt - 60_000) return token.access

  // Un seul rafraîchissement à la fois, même si plusieurs appels arrivent ensemble
  refreshing ??= requestToken({ grant_type: 'refresh_token', refresh_token: token.refresh })
    .then((data) => saveToken(data, token).access)
    .catch(() => {
      logout()
      return null
    })
    .finally(() => (refreshing = null))
  return refreshing
}
