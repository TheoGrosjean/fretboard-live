/**
 * Les phrasés de l'utilisateur, partagés par les pages Phrasés et Profil : sauvegarde locale (toujours), et
 * synchronisation avec le compte quand on est connecté.
 *
 * Le stockage local reste la copie de travail : l'app marche sans réseau et sans attente. La base en ligne
 * suit en arrière-plan :
 * - chaque modification est envoyée quelques secondes après (seuls les phrasés qui ont changé) ;
 * - à la connexion, au retour sur l'onglet et au retour du réseau, on récupère ce qui a changé ailleurs ;
 * - en cas de conflit, la version modifiée le plus récemment l'emporte, phrasé par phrasé ;
 * - une suppression laisse une trace (« pierre tombale ») pour atteindre les autres appareils.
 */
import { reactive, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { loadPhrases, migratePhrase, savePhrases } from '../lib/phrases'
import { mergePhrases } from '../lib/phraseMerge'
import { explain, useAccount } from './useAccount'

const account = useAccount()

export const phrases = ref(loadPhrases())
/** Demande d'ouverture d'un phrasé (depuis le Profil) : la page Phrasés le sélectionne puis remet à null. */
export const openRequest = ref(null)

// ---------- Sauvegarde locale, regroupée (pendant l'entraînement, les statistiques changent souvent) ----------
let saveTimer = 0
export function flushSave() {
  clearTimeout(saveTimer)
  savePhrases(phrases.value)
}
watch(
  phrases,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, 400)
    schedulePush()
  },
  { deep: true },
)
addEventListener('beforeunload', flushSave)

// ---------- Suppressions à transmettre ----------
const TOMBSTONES_KEY = 'fb.phrases.deleted'
let tombstones = (() => {
  try {
    return JSON.parse(localStorage.getItem(TOMBSTONES_KEY)) ?? []
  } catch {
    return []
  }
})()
const saveTombstones = () => localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones))

/** Supprime un phrasé (et la suppression suivra sur les autres appareils). */
export function removePhrase(id) {
  phrases.value = phrases.value.filter((p) => p.id !== id)
  tombstones = [...tombstones.filter((t) => t.id !== id), { id, at: Date.now() }]
  saveTombstones()
  schedulePush()
}

// ---------- Synchronisation ----------
export const sync = reactive({
  state: 'off', // 'off' (non connecté) | 'syncing' | 'ok' | 'error' | 'offline'
  at: 0, // dernière synchronisation réussie
  error: '',
  pending: 0, // phrasés en attente d'envoi
})
/** Vrai pendant un enregistrement ou un entraînement : on ne remplace pas un phrasé en cours d'utilisation. */
export const busy = ref(false)

const synced = new Map() // id -> contenu connu du serveur (sans updatedAt), pour savoir ce qui a changé
const contentOf = (p) => JSON.stringify({ ...p, updatedAt: 0 })
const userId = () => account.user?.id

function fail(error) {
  const offline = !navigator.onLine || /fetch|network/i.test(error?.message ?? '')
  sync.state = offline ? 'offline' : 'error'
  sync.error = offline ? 'Hors ligne : les modifications partiront au retour du réseau.' : explain(error)
}

const row = (p) => ({ user_id: userId(), id: p.id, data: p, updated: p.updatedAt ?? Date.now(), deleted: false })

async function upload(list, dead) {
  const rows = [...list.map(row), ...dead.map((t) => ({ user_id: userId(), id: t.id, data: null, updated: t.at, deleted: true }))]
  if (!rows.length) return true
  const { error } = await supabase.from('phrases').upsert(rows, { onConflict: 'user_id,id' })
  if (error) {
    fail(error)
    return false
  }
  for (const p of list) synced.set(p.id, contentOf(p))
  const sent = new Set(dead.map((t) => t.id))
  tombstones = tombstones.filter((t) => !sent.has(t.id))
  saveTombstones()
  return true
}

let pulling = null
/** Récupère les phrasés en ligne, fusionne, et envoie ce qui est plus récent ici. */
export async function syncNow() {
  if (!userId()) return
  if (busy.value) return schedulePull() // on attend la fin de l'entraînement
  if (pulling) return pulling
  pulling = (async () => {
    sync.state = 'syncing'
    const { data, error } = await supabase.from('phrases').select('id, data, updated, deleted')
    if (error) return fail(error)
    if (busy.value) return schedulePull()
    // Pierre tombale dépassée (le phrasé a été recréé ou modifié ailleurs après) : on l'oublie
    tombstones = tombstones.filter((t) => !data.some((r) => r.id === t.id && !r.deleted && r.updated > t.at))
    saveTombstones()
    const { list, push, dead } = mergePhrases(phrases.value, data, tombstones)
    for (const r of data) if (!r.deleted) synced.set(r.id, JSON.stringify({ ...migratePhrase(r.data), updatedAt: 0 }))
    phrases.value = list
    if (await upload(push, dead)) {
      sync.state = 'ok'
      sync.at = Date.now()
      sync.error = ''
      sync.pending = 0
    }
  })().finally(() => (pulling = null))
  return pulling
}

// Envoi des modifications : quelques secondes après la dernière retouche, seulement ce qui a changé
let pushTimer = 0
function schedulePush() {
  if (!userId()) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushChanges, 2500)
}
async function pushChanges() {
  if (!userId()) return
  const changed = phrases.value.filter((p) => synced.get(p.id) !== contentOf(p))
  sync.pending = changed.length + tombstones.length
  if (!changed.length && !tombstones.length) return
  // La date de modification part avec le phrasé : c'est elle qui départage les appareils
  const now = Date.now()
  for (const p of changed) if (!p.updatedAt || now - p.updatedAt > 1000) p.updatedAt = now
  sync.state = 'syncing'
  if (await upload(changed, [...tombstones])) {
    sync.state = 'ok'
    sync.at = Date.now()
    sync.error = ''
    sync.pending = 0
  }
}
let pullTimer = 0
function schedulePull() {
  clearTimeout(pullTimer)
  pullTimer = setTimeout(syncNow, 3000)
}

// Connexion / déconnexion : première synchronisation, ou retour au mode local
watch(
  () => account.user?.id,
  (id) => {
    synced.clear()
    if (id) syncNow()
    else Object.assign(sync, { state: 'off', at: 0, error: '', pending: 0 })
  },
  { immediate: true },
)
// Retour sur l'onglet (changements faits sur un autre appareil) et retour du réseau
let lastPull = 0
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && userId() && Date.now() - lastPull > 20000) {
    lastPull = Date.now()
    syncNow()
  }
})
addEventListener('online', () => userId() && syncNow())
watch(busy, (b) => !b && userId() && schedulePush())

/** Efface les phrasés en ligne du compte (ils restent sur cet appareil). */
export async function deleteRemotePhrases() {
  if (!userId()) return false
  const { error } = await supabase.from('phrases').delete().eq('user_id', userId())
  if (error) {
    fail(error)
    return false
  }
  synced.clear()
  return true
}
