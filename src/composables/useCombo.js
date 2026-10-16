import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { DECAY_MS, checkSilence, createRun, multiplierFor, playNote, tierProgress } from '../lib/combo'

const RECORDS_KEY = 'fb.records'

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) ?? {}
  } catch {
    return {}
  }
}

/**
 * État réactif du combo pour la gamme courante.
 * scaleKey : identifiant de la gamme (les records sont gardés par gamme ; changer de gamme démarre une nouvelle partie)
 * scaleSize : nombre de notes de la gamme
 */
export function useCombo({ scaleKey, scaleSize }) {
  let run = createRun()
  const version = ref(0) // incrémenté à chaque changement de `run` pour rafraîchir les computed
  const touch = () => version.value++

  const records = ref(loadRecords())
  const announcement = shallowRef(null) // { id, text, tone }
  const floater = shallowRef(null) // { id, text } : points gagnés
  const lastNoteAt = ref(0) // pour l'animation de la jauge de temps
  const brokeAt = ref(0) // pour la secousse du manche
  let announceTimer = 0
  let eventId = 0

  const state = computed(() => {
    version.value
    const record = records.value[scaleKey.value] ?? { score: 0, combo: 0 }
    return {
      combo: run.combo,
      mult: multiplierFor(run.combo),
      progress: tierProgress(run.combo),
      score: run.score,
      misses: run.misses,
      notes: run.notes,
      accuracy: run.notes ? Math.round((run.hits / run.notes) * 100) : null,
      bestCombo: run.bestCombo,
      record,
    }
  })

  function announce(text, tone = 'copper') {
    clearTimeout(announceTimer)
    announcement.value = { id: ++eventId, text, tone }
    announceTimer = setTimeout(() => (announcement.value = null), 1600)
  }

  function saveRecord() {
    const key = scaleKey.value
    const prev = records.value[key] ?? { score: 0, combo: 0 }
    if (run.score <= prev.score && run.bestCombo <= prev.combo) return
    records.value = { ...records.value, [key]: { score: Math.max(prev.score, run.score), combo: Math.max(prev.combo, run.bestCombo) } }
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records.value))
  }

  function handle(events) {
    for (const e of events) {
      if (e.type === 'hit') floater.value = { id: ++eventId, text: `+${e.points}` }
      else if (e.type === 'resolution') {
        floater.value = { id: ++eventId, text: `+${e.points}` }
        announce('Résolution !')
      } else if (e.type === 'full-scale') announce('Gamme complète !')
      else if (e.type === 'tier') announce(e.mult === 4 ? '×4 EN FEU !' : `×${e.mult} !`, e.mult === 4 ? 'fire' : 'copper')
      else if (e.type === 'milestone') announce(`${e.combo} COMBO !`)
      else if (e.type === 'warning') announce('Attention, 1 erreur', 'warn')
      else if (e.type === 'repeat') announce('Varie les notes !', 'warn')
      else if (e.type === 'break') {
        announce(e.reason === 'timeout' ? 'Trop lent… combo perdu' : 'Combo perdu', 'danger')
        brokeAt.value = performance.now()
      }
    }
    if (events.length) {
      saveRecord()
      touch()
    }
  }

  /** Renvoie les événements, pour que l'appelant sache si la note était une note de passage ('glide'). */
  function play(note) {
    lastNoteAt.value = performance.now()
    const events = playNote(run, note, scaleSize.value, lastNoteAt.value)
    handle(events)
    return events
  }

  function reset() {
    run = createRun()
    announcement.value = null
    touch()
  }

  // Changer de gamme = nouvelle partie
  watch(scaleKey, reset)

  const ticker = setInterval(() => handle(checkSilence(run, performance.now())), 200)
  onBeforeUnmount(() => {
    clearInterval(ticker)
    clearTimeout(announceTimer)
  })

  return { state, announcement, floater, lastNoteAt, brokeAt, decayMs: DECAY_MS, play, reset }
}
