/**
 * Compte Fretboard Live (partagé par toutes les pages) : connexion par lien magique, profil, et
 * préférences suivies d'un appareil à l'autre.
 *
 * Connexion : un e-mail contient un lien (à ouvrir dans ce navigateur) et, si le modèle d'e-mail l'affiche,
 * un code à 6 chiffres (pratique quand on lit ses e-mails sur un autre appareil).
 */
import { computed, reactive, shallowRef, watch } from 'vue'
import { supabase } from '../lib/supabase'

// Préférences synchronisées. Le calage du micro, propre à chaque installation, reste sur l'appareil.
export const SYNCED_SETTINGS = [
  'tuning',
  'notation',
  'labelMode',
  'frets',
  'showAlternates',
  'bodyFinish',
  'matchHead',
  'phrases.tolerance',
  'phrases.requireTech',
  'phrases.memory',
  'phrases.gapClick',
  'phrases.demo',
  'phrases.keyCycle',
  'phrases.guideVolume',
]
const SETTINGS_MARK = 'fb.settings.synced' // { at, json } : dernière version échangée avec le compte
const RETURN_KEY = 'fb.auth.return' // onglet à rouvrir après le lien magique

function readSettings() {
  const out = {}
  for (const key of SYNCED_SETTINGS) {
    try {
      const v = localStorage.getItem(`fb.${key}`)
      if (v !== null) out[key] = JSON.parse(v)
    } catch {
      /* valeur illisible : ignorée */
    }
  }
  return out
}
/** Écrit des préférences reçues du compte, puis prévient les pages pour qu'elles les relisent. */
function writeSettings(settings) {
  for (const [key, value] of Object.entries(settings ?? {})) if (SYNCED_SETTINGS.includes(key)) localStorage.setItem(`fb.${key}`, JSON.stringify(value))
  dispatchEvent(new Event('fb:settings'))
}
const readMark = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_MARK)) ?? { at: 0, json: '' }
  } catch {
    return { at: 0, json: '' }
  }
}
const writeMark = (mark) => localStorage.setItem(SETTINGS_MARK, JSON.stringify(mark))

/** Message d'erreur Supabase en français. */
export function explain(error) {
  const m = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  if (m.includes('schema cache') || m.includes('pgrst205') || m.includes('42p01')) return 'La base en ligne n’est pas encore prête : il reste à lancer le script supabase/schema.sql.'
  if (m.includes('jwt') || m.includes('401')) return 'Session expirée : reconnecte-toi.'
  if (m.includes('not authorized') || m.includes('not allowed')) return 'Cette adresse ne peut pas encore recevoir d’e-mail de connexion (voir la configuration e-mail de Supabase).'
  if (m.includes('rate') || m.includes('429') || m.includes('security purposes')) return 'Trop de demandes : attends une minute avant de redemander un lien.'
  if (m.includes('invalid') && m.includes('email')) return 'Adresse e-mail invalide.'
  if (m.includes('expired') || m.includes('otp')) return 'Code ou lien expiré : redemande un lien.'
  if (m.includes('fetch') || m.includes('network')) return 'Pas de connexion internet.'
  return error?.message || 'Erreur inconnue.'
}

const session = shallowRef(null)
const state = reactive({
  ready: false, // session lue au démarrage
  profile: null, // { id, display_name, settings, settings_updated, created_at }
  error: '', // dernière erreur (connexion, profil)
  linkSentTo: '', // e-mail auquel le lien vient d'être envoyé
  sending: false,
  settingsAt: 0, // dernière synchronisation des préférences
})
const user = computed(() => session.value?.user ?? null)

// Retour du lien magique : ?code= (échangé par supabase-js) ou ?error= ; on nettoie l'adresse
function cleanUrl() {
  const q = new URLSearchParams(location.search)
  if (q.has('code') || q.has('error') || q.has('error_description')) {
    if (q.get('error_description')) state.error = q.get('error_code') === 'otp_expired' ? 'Ce lien a expiré : redemande un lien.' : q.get('error_description')
    history.replaceState(null, '', location.pathname + location.hash)
  }
}
cleanUrl()

supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
  state.ready = true
})
supabase.auth.onAuthStateChange((event, s) => {
  session.value = s
  if (event === 'SIGNED_IN') {
    state.linkSentTo = ''
    cleanUrl()
    const back = sessionStorage.getItem(RETURN_KEY)
    if (back) {
      sessionStorage.removeItem(RETURN_KEY)
      if (location.hash !== back) location.hash = back
    }
  }
})

// ---------- Profil ----------
async function loadProfile(u) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', u.id).maybeSingle()
  if (error) return void (state.error = explain(error))
  if (data) return void (state.profile = data)
  // Première connexion : le profil est créé avec le début de l'adresse e-mail comme nom
  const created = await supabase
    .from('profiles')
    .insert({ id: u.id, display_name: (u.email ?? '').split('@')[0].slice(0, 60) })
    .select()
    .single()
  if (created.error) state.error = explain(created.error)
  else state.profile = created.data
}
async function updateProfile(patch) {
  if (!user.value || !state.profile) return
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', user.value.id).select().single()
  if (error) state.error = explain(error)
  else state.profile = data
}

// ---------- Préférences ----------
// Dernière version échangée (mark) : si seul le compte a changé depuis, on l'applique ; si l'appareil a
// changé, il l'emporte et l'envoie.
async function syncSettings() {
  if (!user.value || !state.profile) return
  const local = readSettings()
  const json = JSON.stringify(local)
  const mark = readMark()
  const remoteAt = state.profile.settings_updated ?? 0
  const localChanged = json !== mark.json
  if (remoteAt > mark.at && !localChanged) {
    writeSettings(state.profile.settings)
    writeMark({ at: remoteAt, json: JSON.stringify(readSettings()) })
  } else if (localChanged || !remoteAt) {
    const at = Date.now()
    await updateProfile({ settings: local, settings_updated: at })
    writeMark({ at, json })
  }
  state.settingsAt = Date.now()
}

watch(user, async (u, before) => {
  state.profile = null
  if (!u) return
  if (before && before.id !== u.id) localStorage.removeItem(SETTINGS_MARK) // autre compte : on repart de zéro
  await loadProfile(u)
  await syncSettings()
})
// Retour sur l'onglet : les préférences ont pu changer ailleurs
let lastFocus = 0
addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !user.value || Date.now() - lastFocus < 30000) return
  lastFocus = Date.now()
  loadProfile(user.value).then(syncSettings)
})

// ---------- Connexion ----------
async function sendLink(email) {
  state.error = ''
  state.sending = true
  sessionStorage.setItem(RETURN_KEY, location.hash || '#profil')
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } })
  state.sending = false
  if (error) state.error = explain(error)
  else state.linkSentTo = email.trim()
}
async function verifyCode(token) {
  state.error = ''
  const { error } = await supabase.auth.verifyOtp({ email: state.linkSentTo, token: token.trim(), type: 'email' })
  if (error) state.error = explain(error)
}
async function signOut() {
  await supabase.auth.signOut()
  state.profile = null
}

const account = reactive({
  user,
  state,
  sendLink,
  verifyCode,
  signOut,
  updateProfile,
  syncSettings,
  cancelLink: () => (state.linkSentTo = ''),
  initial: computed(() => (state.profile?.display_name || user.value?.email || '?').trim().charAt(0).toUpperCase()),
})
export const useAccount = () => account
