/**
 * Fusion des phrasés d'un appareil avec ceux du compte (voir composables/phraseStore.js).
 * Phrasé par phrasé, la version modifiée le plus récemment l'emporte ; une suppression (pierre tombale)
 * l'emporte sur une version plus ancienne qu'elle.
 */
import { migratePhrase } from './phrases'

/**
 * Fusion locale / en ligne. Renvoie { list, push (phrasés à envoyer), dead (suppressions à envoyer) }.
 * remote : [{ id, data, updated, deleted }]
 */
export function mergePhrases(local, remote, graves) {
  const remoteById = new Map(remote.map((r) => [r.id, r]))
  const buried = new Map(graves.map((t) => [t.id, t.at]))
  const out = []
  const push = []
  for (const p of local) {
    const r = remoteById.get(p.id)
    if (!r) push.push(p) // jamais envoyé (nouveau, ou première connexion)
    else if (r.deleted) {
      if ((p.updatedAt ?? 0) > r.updated) push.push(p) // modifié ici après la suppression ailleurs : on le garde
      else continue // supprimé sur un autre appareil
    } else if (r.updated > (p.updatedAt ?? 0)) {
      out.push(migratePhrase(r.data)) // plus récent en ligne
      continue
    } else if ((p.updatedAt ?? 0) > r.updated) push.push(p)
    out.push(p)
  }
  for (const r of remote) {
    if (r.deleted || out.some((p) => p.id === r.id) || local.some((p) => p.id === r.id)) continue
    if (buried.has(r.id) && buried.get(r.id) >= r.updated) continue // supprimé ici
    out.push(migratePhrase(r.data)) // créé sur un autre appareil
  }
  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const dead = graves.filter((t) => {
    const r = remoteById.get(t.id)
    return !r || (!r.deleted && r.updated <= t.at)
  })
  return { list: out, push, dead }
}

