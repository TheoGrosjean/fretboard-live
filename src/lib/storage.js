/**
 * Réglages gardés dans le navigateur : clés « fb.<nom> », valeurs en JSON.
 * Stockage bloqué, plein ou valeur illisible : on garde la valeur par défaut, sans erreur.
 */
import { ref, watch } from 'vue'

export function readStored(key, initial) {
  try {
    const v = localStorage.getItem(`fb.${key}`)
    return v !== null ? JSON.parse(v) : initial
  } catch {
    return initial
  }
}

/** Ref enregistrée à chaque changement. */
export function persisted(key, initial) {
  const r = ref(readStored(key, initial))
  watch(r, (v) => {
    try {
      localStorage.setItem(`fb.${key}`, JSON.stringify(v))
    } catch {
      /* stockage plein ou bloqué */
    }
  })
  return r
}

/** Relit des réglages changés ailleurs (autre page, compte synchronisé) : { clé: ref }. */
export function reloadPersisted(refs) {
  for (const [key, r] of Object.entries(refs)) {
    const v = readStored(key, undefined)
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(r.value)) r.value = v
  }
}
