/**
 * Le « cerveau » de la page Phrasés : bibliothèque, enregistrement (sur le clic, ou en prise libre),
 * édition, entraînement en boucle, calibration du micro, clavier.
 * La page et ses panneaux le reçoivent par provide / inject (clé 'phrase-studio') et n'en sont que l'affichage.
 *
 * Déroulé (mode) : 'idle' | 'record' (sur le clic) | 'free' (prise libre) | 'practice' | 'listen' | 'calibrate'.
 */
import { computed, markRaw, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { useAudioInput } from './useAudioInput'
import { MAX_BPM, MIN_BPM, useMetronome } from './useMetronome'
import { DEFAULT_BODY_FINISH } from '../lib/noteStyles'
import { findPositions, findTuning, noteName } from '../lib/music'
import { GRID_MIX, bendLabel, exportPhrases, gridStep, importPhrases, loopLength, newPhrase, noteLength, onGrid, oneNotePerBeat, placeNotes, powerShape, quantize, stepBeat, techOf, uid } from '../lib/phrases'
import { busy, flushSave, openRequest, phrases, removePhrase } from './phraseStore'
import { autoAlign, inferRhythm, requantize, shiftAll, smartQuantize } from '../lib/phraseRhythm'
import {
  alignPass,
  burstTempo,
  hardSpot,
  latencyCorrection,
  masteredTempo,
  mastery,
  matchNote,
  nextTempo,
  noteProfile,
  passTargets,
  progressState,
  projection,
  reviewLabel,
  scheduleReview,
  scorePass,
  sessionQuality,
  timingDrifts,
  toleranceOf,
  updateNoteStats,
} from '../lib/phraseCoach'
import { pluck, pluckTimed, pluckVoice } from '../lib/pluck'
import { persisted, reloadPersisted } from '../lib/storage'

export const STUDIO_KEY = 'phrase-studio'

// Les notes sont datées à leur attaque (voir useAudioInput) ; leur reconnaissance arrive ensuite, jusqu'à
// ~140 ms plus tard : on attend ce délai avant de déclarer une note ratée
const DETECT_SLACK_MS = 140
const RELEASE_LAG_MS = 120 // la fin d'une note n'est constatée qu'après ce silence
const MAX_RECORD_BARS = 16
const SILENCE_BARS = 2 // silence qui termine l'enregistrement sur le clic
const FREE_SILENCE_MS = 3000 // silence qui termine une prise libre
const FREE_MAX_MS = 45000
const HISTORY_SIZE = 50

export function usePhraseStudio() {
  // ---------- Réglages partagés avec le Manche (mêmes clés) ----------
  const tuningId = persisted('tuning', 'standard')
  const notation = persisted('notation', 'fr')
  const labelMode = persisted('labelMode', 'note')
  const frets = persisted('frets', 22)
  const showAlternates = persisted('showAlternates', true)
  const bodyFinish = persisted('bodyFinish', DEFAULT_BODY_FINISH)
  const matchHead = persisted('matchHead', false)
  const tuning = computed(() => findTuning(tuningId.value).notes)
  // Le Manche a pu changer ces réglages pendant qu'on était ailleurs : on les relit en revenant
  const reloadShared = () =>
    reloadPersisted({ tuning: tuningId, notation, labelMode, frets, showAlternates, bodyFinish, matchHead, 'phrases.tolerance': toleranceId, 'phrases.requireTech': requireTech, 'phrases.memory': memory, 'phrases.gapClick': gapClick, 'phrases.demo': demo, 'phrases.keyCycle': keyCycle, 'phrases.guideVolume': guideVolume })
  // Préférences reçues du compte (autre appareil)
  addEventListener('fb:settings', reloadShared)

  // ---------- Préférences d'entraînement ----------
  // Calage : délai d'entrée (interface audio -> navigateur). Les notes étant datées à leur attaque, il ne couvre
  // plus le temps de reconnaissance : nouvelle clé, l'ancienne valeur (qui l'incluait) serait trop grande
  const latency = persisted('phrases.inputLatency', 20)
  const toleranceId = persisted('phrases.tolerance', 'normal')
  const requireTech = persisted('phrases.requireTech', false) // un passage n'est propre que si les techniques sont jouées
  const autoLatency = persisted('phrases.autoLatency', true) // le calage s'ajuste tout seul pendant l'entraînement
  const memory = persisted('phrases.memory', 'guided') // 'guided' | 'next' | 'blind' | 'auto' (aides retirées peu à peu)
  const gapClick = persisted('phrases.gapClick', 'off') // 'off' | 'bars' (une mesure sur deux) | 'passes' (un passage sur deux)
  const demo = persisted('phrases.demo', 'off') // 'off' | 'call' (écoute puis joue) | 'along' (joue avec toi)
  const keyCycle = persisted('phrases.keyCycle', 'off') // 'off' | 'fourths' (cycle des quartes) | 'chromatic'
  const guideVolume = persisted('phrases.guideVolume', 0.6)
  const view = persisted('phrases.view', 'studio') // onglet : 'studio' | 'practice' | 'progress'
  const libraryOpen = persisted('phrases.libraryOpen', true)
  const boardOpen = persisted('phrases.boardOpen', true) // manche affiché (replié : tout le reste tient à l'écran)
  const toleranceMs = computed(() => toleranceOf(toleranceId.value).ms)
  const settingsOpen = ref(false)
  const helpOpen = ref(false)

  // ---------- Bibliothèque (partagée avec le Profil, sauvegardée et synchronisée par phraseStore) ----------
  const selectedId = persisted('phrases.selected', phrases.value[0]?.id ?? null)
  const phrase = computed(() => phrases.value.find((p) => p.id === selectedId.value) ?? null)
  // Le phrasé affiché a disparu (supprimé sur un autre appareil) : on passe au premier
  watch(phrases, (list) => {
    if (selectedId.value && !list.some((p) => p.id === selectedId.value)) selectedId.value = list[0]?.id ?? null
  })
  // Ouverture demandée depuis le Profil (page déjà en mémoire ; sinon le choix est relu au chargement)
  watch(openRequest, (id) => {
    if (!id) return
    if (phrases.value.some((p) => p.id === id)) {
      stopAll()
      selectedId.value = id
      resetEditing()
    }
    openRequest.value = null
  })
  const touch = () => phrase.value && (phrase.value.updatedAt = Date.now())

  const metro = useMetronome({ storageKey: 'phrases.metronome' })
  watch(guideVolume, (v) => metro.setGuideVolume(v), { immediate: true })

  function createPhrase() {
    stopAll()
    const p = newPhrase({ name: `Phrasé ${phrases.value.length + 1}`, bpm: metro.bpm.value, beats: metro.beats.value, grid: metro.subdiv.value })
    phrases.value.unshift(p)
    selectedId.value = p.id
    resetEditing()
    view.value = 'studio'
  }
  function selectPhrase(id) {
    if (id === selectedId.value) return
    stopAll()
    selectedId.value = id
    resetEditing()
  }
  const confirmDelete = ref(false)
  function deletePhrase() {
    if (!confirmDelete.value) return void (confirmDelete.value = true)
    stopAll()
    removePhrase(selectedId.value)
    selectedId.value = phrases.value[0]?.id ?? null
    resetEditing()
  }
  function duplicatePhrase() {
    const p = phrase.value
    if (!p) return
    stopAll()
    const copy = JSON.parse(JSON.stringify(p))
    Object.assign(copy, { id: uid() + Date.now().toString(36), name: `${p.name} (copie)`.slice(0, 60), createdAt: Date.now(), updatedAt: Date.now(), review: null, sessions: [], noteStats: {}, bestBpm: 0 })
    copy.notes = copy.notes.map((n) => ({ ...n, id: uid() }))
    phrases.value.splice(phrases.value.indexOf(p) + 1, 0, copy)
    selectedId.value = copy.id
    resetEditing()
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'phrase'
  const exportCurrent = () => phrase.value && download(`phrase-${slug(phrase.value.name)}.json`, exportPhrases([phrase.value]))
  const exportAll = () => download('fretboard-live-phrases.json', exportPhrases(phrases.value))
  const importError = ref('')
  async function importFile(file) {
    importError.value = ''
    try {
      const list = importPhrases(await file.text()).map((p) => ({ ...p, notes: placeNotes(p.notes, tuning.value, frets.value, { zone: p.zone }) }))
      if (!list.length) throw new Error('vide')
      phrases.value.unshift(...list)
      selectedId.value = list[0].id
      resetEditing()
      say(list.length > 1 ? `${list.length} phrasés importés` : `« ${list[0].name} » importé`)
    } catch {
      importError.value = 'Ce fichier ne contient pas de phrasés lisibles.'
    }
  }
  // Tablature Guitar Pro : la fenêtre d'import (choix de la piste et des mesures) est ouverte tant qu'un fichier est là
  const gpFile = shallowRef(null)
  /** Phrasé créé depuis les mesures choisies (lib/gpImport.phraseFromBars), ouvert à l'entraînement. */
  function addImported(data) {
    stopAll()
    const p = newPhrase({ name: data.name, bpm: data.bpm, beats: data.beats, grid: data.grid })
    const target = Math.min(MAX_BPM, Math.max(MIN_BPM, data.bpm)) // le tempo du morceau est l'objectif
    Object.assign(p, { minBars: Math.round(data.lengthBeats / data.beats), targetBpm: target, startBpm: Math.max(MIN_BPM, Math.round((target * 0.6) / 5) * 5) })
    p.bpm = p.startBpm
    p.notes = place(data.notes, p)
    fitLength(p)
    phrases.value.unshift(p)
    selectedId.value = p.id
    gpFile.value = null
    resetEditing()
    view.value = 'practice'
    say(`« ${p.name} » importé`)
  }

  // ---------- Écoute de la guitare ----------
  const audio = useAudioInput({ lowestMidi: () => Math.min(...tuning.value), onNote })
  const played = shallowRef(null) // note entendue, affichée un instant : { midi, string, fret }
  let playedTimer = 0
  function showPlayed(midi, position) {
    clearTimeout(playedTimer)
    played.value = position ? { midi, string: position.string, fret: position.fret } : null
    playedTimer = setTimeout(() => (played.value = null), 600)
  }
  const ensureAudio = () => !audio.running.value && audio.start()

  // ---------- Déroulé ----------
  const mode = ref('idle')
  watch(mode, (m) => (busy.value = m !== 'idle')) // pas de synchronisation qui remplace un phrasé en cours d'utilisation
  const now = ref(null) // position courante, en temps depuis le premier clic (null si arrêté)
  const clock = ref(0) // performance.now() de la dernière image (prise libre, écoute)
  let raf = 0
  const countIn = computed(() => (mode.value === 'calibrate' ? 4 : (phrase.value?.beats ?? 4))) // une mesure de décompte
  const counting = computed(() => ['record', 'practice', 'calibrate'].includes(mode.value) && now.value !== null && now.value < countIn.value)
  const countdown = computed(() => (counting.value ? Math.min(countIn.value, Math.ceil(countIn.value - now.value)) : 0))

  function loop() {
    clock.value = performance.now()
    now.value = metro.beatAt(clock.value)
    if (mode.value === 'record') recordTick()
    else if (mode.value === 'free') freeTick()
    else if (mode.value === 'practice') practiceTick()
    else if (mode.value === 'listen') listenTick()
    else if (mode.value === 'calibrate') calibrateTick()
    raf = requestAnimationFrame(loop)
  }
  function run(m) {
    mode.value = m
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(loop)
  }
  function stopAll() {
    const m = mode.value
    if (m === 'record') finishRecording()
    else if (m === 'free') finishFreeTake()
    else if (m === 'practice') finishPractice()
    else if (m === 'listen') stopListening()
    else if (m === 'calibrate') finishCalibration()
    cancelAnimationFrame(raf)
    metro.stop()
    metro.setMute(null)
    metro.setScheduler(null)
    mode.value = 'idle'
    now.value = null
  }

  /** Instant d'une note entendue, en temps sur la grille du métronome : son attaque, moins le délai d'entrée. */
  const heardBeat = (n) => metro.beatAt((n?.at ?? performance.now()) - latency.value)
  /** Bend sur la note tenue : elle reste la note attaquée (même case) ; on retient l'amplitude du tiré, et le relâché. */
  function bendHeld(held, midi) {
    if (!held) return
    const steps = midi - held.midi
    if (steps > 0) held.bend = Math.max(held.bend ?? 0, steps)
    else if (held.bend) held.release = true
  }
  /** Note arrivée sans nouvelle attaque depuis la précédente : slide, ou lié (hammer-on / pull-off). */
  const techAfter = (held, n) => (held ? (n.slide ? 'slide' : n.legato ? 'legato' : null) : null)
  /** Palm mute : décidé par la détection peu après l'attaque ; reporté sur la note en cours d'enregistrement. */
  function settleMute() {
    if (!holding?.n?.muted) return
    const list = mode.value === 'free' ? freeOnsets : takes.value
    const t = list.find((x) => x.id === holding.id)
    if (t) t.pm = true
  }

  function onNote(n) {
    if (n.octaveFix) return fixOctave(n)
    if (mode.value === 'record') recordNote(n)
    else if (mode.value === 'free') freeNote(n)
    else if (mode.value === 'practice') practiceNote(n)
    else if (mode.value === 'calibrate') calibrateNote(n)
    else showPlayed(n.midi, nearestPosition(n.midi, played.value))
  }

  /** La détection corrige l'octave de la note qu'elle vient d'annoncer : on corrige cette note, sans en ajouter. */
  function fixOctave(n) {
    if (mode.value === 'record' || mode.value === 'free') {
      const list = mode.value === 'free' ? freeOnsets : takes.value
      const held = holding && list.find((t) => t.id === holding.id)
      if (!held) return
      held.midi = n.midi
      if (mode.value === 'record') takes.value = place(takes.value.map((t) => (t.id === held.id ? { ...t, string: undefined, fret: undefined } : t)))
      showPlayed(n.midi, mode.value === 'record' ? takes.value.find((t) => t.id === held.id) : nearestPosition(n.midi, played.value))
    } else if (mode.value === 'practice') {
      // Note déjà validée (octave tolérée) : rien à refaire ; sinon on la rejuge avec la bonne hauteur
      if (!lastEvent || lastEvent.ok) {
        if (lastEvent) lastEvent.midi = n.midi
        return
      }
      for (const pass of passes.values()) pass.events = pass.events.filter((e) => toRaw(e) !== lastEvent) // les passages sont réactifs
      lastHeard = null
      practiceNote({ ...n, octaveFix: false })
    } else if (mode.value === 'idle') showPlayed(n.midi, nearestPosition(n.midi, played.value))
  }

  /** Position la plus proche d'une note de repère (sinon la première jouable). */
  function nearestPosition(midi, near) {
    const all = findPositions(midi, tuning.value, frets.value)
    if (!all.length) return null
    if (!near) return all[0]
    const d = (p) => Math.abs(p.fret - near.fret) + Math.abs(p.string - near.string) * 0.5
    return all.reduce((best, p) => (d(p) < d(best) ? p : best))
  }
  const place = (notes, p = phrase.value) => placeNotes(oneNotePerBeat(notes), tuning.value, frets.value, { zone: p?.zone ?? null })

  // ---------- Historique des retouches (annuler / rétablir) ----------
  const past = ref([])
  const future = ref([])
  const snapshot = (label) => {
    const p = phrase.value
    // La lecture d'une prise libre (tempo retrouvé, autres lectures) suit l'historique
    // Copie du tableau : le glisser remplace des notes en place (les notes elles-mêmes ne sont jamais modifiées)
    return { notes: [...p.notes], lengthBeats: p.lengthBeats, minBars: p.minBars, grid: p.grid, beats: p.beats, recordBpm: p.recordBpm, free: freeResult.value, label }
  }
  /** Empile un état à annuler ; une nouvelle retouche efface ce qui pouvait être rétabli. */
  function remember(state) {
    past.value = [...past.value.slice(-(HISTORY_SIZE - 1)), state]
    future.value = []
  }
  function commit(label) {
    remember(snapshot(label))
    touch()
  }
  function restore(s) {
    Object.assign(phrase.value, { notes: s.notes, lengthBeats: s.lengthBeats, minBars: s.minBars ?? null, grid: s.grid, beats: s.beats, recordBpm: s.recordBpm })
    if (freeResult.value || s.free) {
      freeResult.value = s.free ?? null
      if (s.free) metro.setBpm(s.recordBpm)
    }
    selectedNote.value = null
    alignInfo.value = ''
  }
  function undo() {
    const s = past.value.at(-1)
    if (!s || mode.value !== 'idle') return
    future.value = [...future.value, snapshot(s.label)]
    past.value = past.value.slice(0, -1)
    restore(s)
  }
  function redo() {
    const s = future.value.at(-1)
    if (!s || mode.value !== 'idle') return
    past.value = [...past.value, snapshot(s.label)]
    future.value = future.value.slice(0, -1)
    restore(s)
  }
  function resetEditing() {
    entry.value = null
    selectedNote.value = null
    confirmDelete.value = false
    past.value = []
    future.value = []
    alignInfo.value = ''
    freeResult.value = null
    summary.value = null
  }

  // ---------- Enregistrement sur le clic ----------
  const takes = ref([]) // notes de la prise en cours
  const punch = ref(null) // section réenregistrée : { from, to } en temps, ou null
  let recordSnapshot = null
  let holding = null // note en cours d'enregistrement : { id, raw (prise sur le clic), n (note détectée) }
  const recordGrid = computed(() => (punch.value ? phrase.value.grid : metro.subdiv.value))

  async function startRecording({ section = false } = {}) {
    if (!phrase.value) createPhrase()
    stopAll()
    selectedNote.value = null
    summary.value = null
    ensureAudio()
    const p = phrase.value
    punch.value = section && p.loop && p.notes.length ? { ...p.loop } : null
    if (!punch.value) {
      // La prise utilise la mesure et la grille du métronome
      p.beats = metro.beats.value
      p.recordBpm = metro.bpm.value
    } else metro.beats.value = p.beats
    recordSnapshot = snapshot('Enregistrement')
    takes.value = []
    holding = null
    view.value = 'studio'
    await metro.start()
    run('record')
  }
  const startPunch = () => startRecording({ section: true })

  function recordNote(n) {
    const b = heardBeat(n)
    // Pendant le décompte, on tolère une note jouée juste avant le premier temps
    if (b === null || b < countIn.value - 0.5) return
    const offset = punch.value?.from ?? 0
    const raw = b - countIn.value + offset // instant réellement joué : sert au calage automatique
    if (punch.value && (raw < punch.value.from - 0.25 || raw >= punch.value.to)) return
    const held = holding && takes.value.find((t) => t.id === holding.id)
    if (n.bend) {
      bendHeld(held, n.midi)
      showPlayed(n.midi, held)
      return
    }
    const beat = Math.max(punch.value?.from ?? 0, quantize(raw, recordGrid.value))
    if (takes.value.some((t) => Math.abs(t.beat - beat) < 1e-6)) return // une note par case (la même entendue deux fois…)
    settleMute()
    const id = uid()
    takes.value = place([...takes.value, { id, midi: n.midi, beat, raw, legato: !!n.legato, tech: techAfter(held, n) }])
    holding = { id, raw, n }
    showPlayed(
      n.midi,
      takes.value.find((t) => t.id === id),
    )
  }
  // Durée tenue : quand le son s'arrête, la note en cours reçoit sa durée (calée sur la grille)
  watch(audio.current, (c) => {
    if (c || !holding) return
    settleMute()
    if (mode.value === 'record') {
      const b = metro.beatAt(performance.now() - RELEASE_LAG_MS - latency.value)
      const take = takes.value.find((t) => t.id === holding.id)
      const grid = recordGrid.value
      if (take && b !== null) take.dur = Math.max(gridStep(grid), quantize(b - countIn.value + (punch.value?.from ?? 0) - holding.raw, grid === GRID_MIX ? 4 : grid))
    } else if (mode.value === 'free') {
      const onset = freeOnsets.find((o) => o.id === holding.id)
      if (onset) onset.dur = (performance.now() - RELEASE_LAG_MS - latency.value) / 1000 - onset.t
    }
    holding = null
  })
  function recordTick() {
    const p = phrase.value
    if (now.value === null || now.value < countIn.value) return
    const elapsed = now.value - countIn.value
    if (punch.value) {
      if (elapsed > punch.value.to - punch.value.from + 0.5) stopAll()
      return
    }
    const last = takes.value.length ? Math.max(...takes.value.map((t) => t.raw)) : null
    if ((last !== null && elapsed - last > SILENCE_BARS * p.beats) || elapsed > MAX_RECORD_BARS * p.beats) stopAll()
  }
  function finishRecording() {
    const p = phrase.value
    if (!p) return
    settleMute()
    const before = recordSnapshot
    recordSnapshot = null
    const notes = takes.value
    takes.value = []
    if (!notes.length) {
      if (before) restore(before)
      punch.value = null
      return
    }
    remember(before)
    const grid = recordGrid.value
    // Grille mixte : chaque temps reçoit sa grille, d'après les instants joués
    const placed = grid === GRID_MIX ? smartQuantize(notes.map((n) => n.raw), p.recordBpm).map((b, i) => ({ ...notes[i], beat: Math.max(0, b) })) : notes
    if (punch.value) {
      const { from, to } = punch.value
      p.notes = place([...p.notes.filter((n) => n.beat < from - 1e-6 || n.beat >= to - 1e-6), ...placed])
      say('Section réenregistrée')
    } else {
      p.grid = grid
      p.notes = place(placed)
      p.loop = null
      // Nouvelle prise : la progression repart du tempo de départ
      p.startBpm = Math.max(40, p.recordBpm - 20)
      p.targetBpm = Math.max(p.targetBpm, p.recordBpm)
      p.bpm = p.startBpm
      p.bestBpm = 0
      p.noteStats = {}
      p.minBars = null
    }
    fitLength(p)
    punch.value = null
    alignInfo.value = ''
    touch()
  }

  // ---------- Prise libre : sans métronome, le tempo est retrouvé après coup ----------
  let freeOnsets = [] // [{ id, t (s), dur?, midi, legato, tech, bend?, release? }]
  const freeCount = ref(0)
  const freeStart = ref(0)
  const freeResult = ref(null) // { bpm, feel, confidence, errorMs, alternatives } : affiché après la prise
  let freeOnsetsKept = null // pour relire la prise à un autre tempo

  function startFreeTake() {
    if (!phrase.value) createPhrase()
    stopAll()
    selectedNote.value = null
    summary.value = null
    freeResult.value = null
    ensureAudio()
    freeOnsets = []
    freeCount.value = 0
    freeStart.value = performance.now()
    holding = null
    recordSnapshot = snapshot('Prise libre')
    view.value = 'studio'
    run('free')
  }
  function freeNote(n) {
    const t = ((n.at ?? performance.now()) - latency.value) / 1000
    const held = holding && freeOnsets.find((o) => o.id === holding.id)
    if (n.bend) return bendHeld(held, n.midi)
    settleMute()
    const id = uid()
    freeOnsets.push({ id, t, midi: n.midi, legato: !!n.legato, tech: techAfter(held, n) })
    freeCount.value = freeOnsets.length
    holding = { id, n }
    showPlayed(n.midi, nearestPosition(n.midi, played.value))
  }
  function freeTick() {
    const last = freeOnsets.at(-1)
    const t = performance.now()
    if ((last && t - latency.value - last.t * 1000 > FREE_SILENCE_MS) || t - freeStart.value > FREE_MAX_MS) stopAll()
  }
  /** Notes d'une lecture de la prise libre. */
  function freeNotes(onsets, r) {
    return onsets.map((o, i) => ({ id: o.id, midi: o.midi, beat: r.beats[i], dur: r.durs[i], legato: o.legato, tech: o.tech, bend: o.bend, release: o.release, pm: o.pm }))
  }
  function applyFreeReading(r, label) {
    const p = phrase.value
    p.notes = place(freeNotes(freeOnsetsKept, r))
    p.grid = r.grid
    p.recordBpm = r.bpm
    fitLength(p)
    metro.setBpm(r.bpm)
    freeResult.value = { bpm: r.bpm, feel: r.feel, confidence: r.confidence, errorMs: r.errorMs, alternatives: r.alternatives.length ? r.alternatives : (freeResult.value?.alternatives ?? []) }
    touch()
    if (label) say(label)
  }
  function finishFreeTake() {
    settleMute()
    const before = recordSnapshot
    recordSnapshot = null
    if (freeOnsets.length < 2) {
      if (before) restore(before)
      return
    }
    remember(before)
    freeOnsetsKept = freeOnsets.map((o) => ({ ...o }))
    const p = phrase.value
    p.beats = metro.beats.value
    p.loop = null
    p.noteStats = {}
    p.bestBpm = 0
    p.minBars = null
    const r = inferRhythm(freeOnsetsKept)
    applyFreeReading(r)
    p.startBpm = Math.max(40, r.bpm - 20)
    p.targetBpm = Math.max(p.targetBpm, r.bpm)
    p.bpm = p.startBpm
  }
  /** Autre lecture de la prise libre (un autre tempo proposé, ou ×2 / ÷2). */
  function reinterpret(bpm) {
    if (!freeOnsetsKept || mode.value !== 'idle') return
    commit('Autre lecture')
    const keep = freeResult.value?.alternatives ?? []
    const previous = freeResult.value ? { bpm: freeResult.value.bpm, feel: freeResult.value.feel } : null
    const r = inferRhythm(freeOnsetsKept, { bpm: Math.min(220, Math.max(50, Math.round(bpm))) })
    r.alternatives = [previous, ...keep].filter((a) => a && Math.abs(a.bpm - r.bpm) > 1)
    applyFreeReading(r, `Lu à ${r.bpm} BPM`)
  }

  // ---------- Écouter le phrasé (son synthétique, au tempo du métronome) ----------
  let listening = null // { stop, startedAt, bpm }
  const listenBeat = ref(0)
  /** Notes à jouer pour le synthé (techniques comprises), en secondes depuis le début. */
  function synthNotes(notes, lengthBeats, bpm, { from = 0, transpose = 0 } = {}) {
    const spb = 60 / bpm
    return notes.flatMap((n, i) => {
      const prev = notes[i - 1]
      const base = { at: (n.beat - from) * spb, length: noteLength(notes, i, lengthBeats) * spb + 0.15 }
      const tech = {
        bend: n.bend || 0,
        release: !!n.release,
        glideFrom: n.tech === 'slide' && prev ? prev.midi + transpose : null, // slide : on glisse depuis la note précédente
        soft: n.tech === 'legato', // lié : attaque douce
        muted: !!n.pm, // palm mute : son court et sourd
      }
      const chord = n.chord === 'power' ? [0, 7, 12] : [0]
      return chord.map((iv) => ({ ...base, ...tech, midi: n.midi + transpose + iv, level: n.chord === 'power' ? 0.13 : undefined }))
    })
  }
  function listen() {
    const p = phrase.value
    if (!p?.notes.length) return
    stopAll()
    const bpm = metro.bpm.value
    listening = { ...pluckTimed(synthNotes(p.notes, p.lengthBeats, bpm)), startedAt: performance.now(), bpm }
    run('listen')
  }
  function listenTick() {
    listenBeat.value = ((performance.now() - listening.startedAt) / 60000) * listening.bpm
    if (listenBeat.value > phrase.value.lengthBeats) stopAll()
  }
  function stopListening() {
    listening?.stop()
    listening = null
  }
  /** Fait entendre une note (double-clic sur la frise). */
  const previewNote = (n) => pluck([n.midi], { gap: 0 })

  // ---------- Entraînement ----------
  const passes = reactive(new Map()) // n° -> { kind, start, bpm, transpose, targets, events, done }
  const results = ref([]) // bilans des passages joués (le plus récent en premier)
  const streak = ref(0) // passages propres d'affilée (affichage de la série)
  const baseBpm = ref(0) // tempo de base de la séance (la méthode le fait évoluer)
  const memoryLevel = ref(0) // aides retirées : 0 tout le phrasé, 1 la note suivante, 2 de mémoire
  const transposeNow = ref(0) // transposition en cours (cycle des tonalités)
  const lastAdjust = ref(0) // dernière correction automatique du calage (ms), affichée un instant
  const summary = ref(null) // bilan de fin de séance
  const toast = ref(null) // annonce : { id, text, tone }
  let toastTimer = 0
  let progress = progressState()
  let session = null
  let memoryClean = 0
  let latencyOffsets = []
  let lastHeard = null // dernière note entendue : { midi, beat }
  let lastHit = null // dernière attente touchée (un bend la prolonge)
  let lastEvent = null // dernière note entendue enregistrée dans un passage (un bend la prolonge)
  let targetAnnounced = false

  function say(text, tone = 'copper') {
    clearTimeout(toastTimer)
    toast.value = { id: Date.now(), text, tone }
    toastTimer = setTimeout(() => (toast.value = null), 2600)
  }

  /** Section travaillée : { from, to } dans le phrasé (tout le phrasé si aucune boucle). */
  const section = computed(() => {
    const p = phrase.value
    if (!p) return { from: 0, to: 4 }
    const l = p.loop
    return l && l.to > l.from && l.from < p.lengthBeats ? { from: Math.max(0, l.from), to: Math.min(p.lengthBeats, l.to) } : { from: 0, to: p.lengthBeats }
  })
  const sectionLength = computed(() => section.value.to - section.value.from)
  const period = computed(() => sectionLength.value + (phrase.value?.rest ?? 0) * (phrase.value?.beats ?? 4))
  const passStart = (k) => countIn.value + k * period.value
  const windowBeats = () => (toleranceMs.value / 60000) * metro.bpm.value
  const currentPass = computed(() => (mode.value === 'practice' && now.value !== null && now.value >= countIn.value - 0.5 ? Math.max(0, Math.floor((now.value - countIn.value + 0.5) / period.value)) : null))
  const shownPass = computed(() => (currentPass.value === null ? null : (passes.get(currentPass.value) ?? null)))

  /** Nature du passage k : démo (appel-réponse), rafale (un passage joué sur deux, méthode Rafales) ou normal. */
  function passKind(k) {
    if (demo.value === 'call' && k % 2 === 0) return 'demo'
    const played = demo.value === 'call' ? (k - 1) / 2 : k
    return phrase.value.method === 'bursts' && played % 2 === 1 ? 'burst' : 'base'
  }
  const tempoFor = (kind) => (kind === 'burst' ? burstTempo(baseBpm.value, phrase.value.burst) : baseBpm.value)
  const clampBpm = (v) => Math.min(240, Math.max(40, Math.round(Number(v) || 0)))
  // Tempo réglé par la séance (et pas à la main) : le métronome le reçoit, la surveillance ci-dessous l'ignore
  let expectedBpm = null
  function setTempo(v) {
    expectedBpm = clampBpm(v)
    metro.setBpm(expectedBpm)
  }

  /** Toutes les notes se jouent sur le manche (accordage et nombre de cases actuels). */
  const fits = (notes) => notes.every((n) => findPositions(n.midi, tuning.value, frets.value).length)
  /** Le phrasé transposé (positions recalculées) ; s'il sort du manche, une octave plus bas ou plus haut. */
  function transposed(semis) {
    const p = phrase.value
    if (!semis) return p.notes
    for (const s of [semis, semis - 12, semis + 12]) {
      const notes = p.notes.map((n) => ({ ...n, midi: n.midi + s, locked: false }))
      if (fits(notes)) return place(notes)
    }
    return p.notes
  }
  const practiceNotes = computed(() => (mode.value === 'practice' && transposeNow.value ? transposed(transposeNow.value) : (phrase.value?.notes ?? [])))

  async function startPractice() {
    const p = phrase.value
    if (!p?.notes.length) return
    stopAll()
    selectedNote.value = null
    summary.value = null
    ensureAudio()
    passes.clear()
    lastHeard = lastHit = lastEvent = null
    results.value = []
    streak.value = 0
    progress = progressState()
    memoryLevel.value = memory.value === 'next' ? 1 : memory.value === 'blind' ? 2 : 0
    memoryClean = 0
    transposeNow.value = 0
    latencyOffsets = []
    targetAnnounced = false
    baseBpm.value = p.bpm || p.startBpm
    metro.beats.value = p.beats
    setTempo(tempoFor(passKind(0)))
    view.value = 'practice'
    session = { at: Date.now(), passes: 0, clean: 0, bestBpm: 0, maxBpm: 0, startBpm: baseBpm.value, recordBefore: p.bestBpm, scores: [] }
    metro.setMute(muteRule())
    metro.setScheduler(demo.value === 'off' ? null : scheduleDemo)
    await metro.start()
    run('practice')
  }
  /** Clic fantôme : mesures (ou passages) sans clic, pour travailler le tempo intérieur. */
  function muteRule() {
    if (gapClick.value === 'off') return null
    const beats = phrase.value.beats
    return (bar) => {
      const beat = bar * beats
      if (beat < countIn.value) return false // le décompte reste audible
      if (gapClick.value === 'bars') return (bar - countIn.value / beats) % 2 === 1
      return Math.floor((beat - countIn.value) / period.value) % 2 === 1
    }
  }
  watch([gapClick, () => phrase.value?.rest], () => mode.value === 'practice' && metro.setMute(muteRule()))
  watch(demo, (d) => mode.value === 'practice' && metro.setScheduler(d === 'off' ? null : scheduleDemo))

  /** Démo du phrasé, programmée sur l'horloge du métronome (appel-réponse, ou en accompagnement). */
  function scheduleDemo({ from, to, timeAt, ctx, dest }) {
    if (!phrase.value || to <= countIn.value) return
    const { from: secFrom, to: secTo } = section.value
    const notes = practiceNotes.value.filter((n) => n.beat >= secFrom - 1e-6 && n.beat < secTo - 1e-6)
    const k0 = Math.max(0, Math.floor((from - countIn.value) / period.value))
    const k1 = Math.floor((to - countIn.value) / period.value)
    for (let k = k0; k <= k1; k++) {
      const kind = passKind(k)
      if (demo.value === 'call' ? kind !== 'demo' : kind === 'demo') continue
      const start = passStart(k)
      const bpm = tempoFor(kind)
      for (const v of synthNotes(notes, secTo, bpm, { from: secFrom })) {
        const beat = start + (v.at * bpm) / 60
        if (beat >= from && beat < to) pluckVoice(ctx, dest, { ...v, level: (v.level ?? 0.22) * (demo.value === 'along' ? 0.7 : 1) }, timeAt(beat))
      }
    }
  }

  function ensurePass(k) {
    if (k < 0 || passes.has(k)) return
    const kind = passKind(k)
    const { from, to } = section.value
    passes.set(k, {
      kind,
      start: passStart(k),
      bpm: tempoFor(kind),
      transpose: transposeNow.value,
      targets: kind === 'demo' ? [] : passTargets(phrase.value.notes, passStart(k), { from, to, transpose: transposeNow.value }),
      events: [],
      done: false,
    })
  }
  function practiceTick() {
    if (now.value === null) return
    const k = Math.max(0, Math.floor((now.value - countIn.value) / period.value))
    ensurePass(k)
    ensurePass(k + 1) // une note jouée un peu en avance sur le passage suivant
    // Une note jouée n'est reconnue qu'un peu plus tard (micro, puis détection) : on attend ce délai, plus
    // une marge, avant de déclarer une note ratée — sinon une note juste arriverait après le verdict
    const heard = metro.beatAt(performance.now() - latency.value - DETECT_SLACK_MS)
    if (heard === null) return
    const win = windowBeats()
    for (const [i, pass] of passes) {
      if (pass.done) continue
      for (const t of pass.targets) if (!t.state && heard > t.beat + win) t.state = 'miss'
      if (heard > pass.start + sectionLength.value + win) finishPass(i, pass)
    }
  }
  function practiceNote(n) {
    const b = heardBeat(n)
    if (b === null || b < countIn.value - windowBeats()) return
    const notes = practiceNotes.value
    // Bend : il prolonge la note attaquée, ce n'est jamais une fausse note. Bend attendu : amplitude vérifiée
    if (n.bend) {
      if (lastEvent) lastEvent.bendMax = Math.max(lastEvent.bendMax, n.midi - lastEvent.midi)
      const t = lastHit
      const reached = t ? n.midi - t.midi : 0
      if (t?.tech === 'bend' && reached > 0 && t.techState !== 'ok' && Math.abs(reached - t.bend) <= bendSlack()) t.techState = 'ok'
      return
    }
    const open = [...passes.values()].filter((x) => !x.done && x.kind !== 'demo')
    const hit = matchNote(
      open.flatMap((x) => x.targets),
      n.midi,
      b,
      windowBeats(),
      { octaveOk: toleranceId.value !== 'strict' },
    )
    const k = Math.floor((b - countIn.value + windowBeats()) / period.value)
    const pass = hit ? open.find((x) => x.targets.includes(hit)) : passes.get(k)
    // Même note redétectée juste après (attaque qui rebondit, note qui s'éteint) : écho, pas fausse note
    const echo = !hit && !!lastHeard && lastHeard.midi === n.midi && b - lastHeard.beat < 0.5
    lastHeard = { midi: n.midi, beat: b }
    if (pass && !pass.done && pass.kind !== 'demo') {
      lastEvent = { midi: n.midi, beat: b, legato: !!n.legato, slide: !!n.slide, bendMax: 0, echo, ok: !!hit }
      pass.events.push(lastEvent)
    }
    if (hit) {
      hit.state = 'hit'
      hit.offset = Math.round(((b - hit.beat) * 60000) / metro.bpm.value)
      lastHit = hit
      // Lié / slide attendu : la note doit arriver sans nouvelle attaque (un petit slide est vu comme un lié)
      if (hit.tech === 'legato' || hit.tech === 'slide') hit.techState = n.legato || n.slide ? 'ok' : 'miss'
      lastOffset.value = { ms: hit.offset, id: Date.now() }
      showPlayed(n.midi, notes[hit.index])
      return
    }
    showPlayed(n.midi, nearestPosition(n.midi, nextTarget.value ? notes[nextTarget.value.index] : played.value))
  }
  const bendSlack = () => (toleranceId.value === 'strict' || toleranceId.value === 'normal' ? 0 : 1)
  const lastOffset = ref(null) // écart de la dernière note juste (aiguille de timing)

  function finishPass(i, pass) {
    pass.done = true
    const p = phrase.value
    if (pass.kind === 'demo') return prune(i)
    // Bilan définitif : alignement optimal de tout le passage (corrige le retour immédiat si besoin)
    const wrong = alignPass(pass.targets, pass.events, { windowBeats: (toleranceMs.value / 60000) * pass.bpm, beatMs: 60000 / pass.bpm, octaveOk: toleranceId.value !== 'strict', bendSlack: bendSlack() })
    const r = { ...scorePass(pass.targets, wrong, { toleranceMs: toleranceMs.value, requireTech: requireTech.value }), n: session.passes + 1, bpm: pass.bpm, kind: pass.kind, transpose: pass.transpose }
    results.value = [r, ...results.value].slice(0, 16)
    session.passes++
    session.scores.push(r.score)
    session.maxBpm = Math.max(session.maxBpm, pass.bpm)
    updateNoteStats((p.noteStats ??= {}), pass.targets)

    // Calage auto : un retard toujours identique vient du micro, pas de toi — il est corrigé petit à petit
    latencyOffsets.push(...pass.targets.filter((t) => t.state === 'hit').map((t) => t.offset))
    if (autoLatency.value) {
      const fix = latencyCorrection(latencyOffsets.slice(-24))
      if (fix) {
        latency.value = Math.min(250, Math.max(0, latency.value + fix))
        lastAdjust.value = fix
        latencyOffsets = []
      }
    }

    if (r.clean) {
      session.clean++
      session.bestBpm = Math.max(session.bestBpm, pass.bpm)
      if (pass.bpm > p.bestBpm) {
        if (p.bestBpm && pass.bpm > session.recordBefore && !session.recordSaid) {
          say(`Nouveau record · ${pass.bpm} BPM`, 'gold')
          session.recordSaid = true
        }
        p.bestBpm = pass.bpm
      }
    }
    // Progression du tempo
    const step = nextTempo(p.method, progress, { clean: r.clean, bpm: baseBpm.value, kind: pass.kind }, p)
    streak.value = progress.streak
    if (step.bpm !== baseBpm.value) {
      baseBpm.value = step.bpm
      p.bpm = step.bpm
    }
    if (step.event === 'up') say(`Palier franchi · ${step.bpm} BPM`)
    else if (step.event === 'down') say(`On souffle · ${step.bpm} BPM`, 'muted')
    else if (step.event === 'burst-ok') say('Rafale réussie ⚡', 'gold')
    if ((step.event === 'target' || baseBpm.value >= p.targetBpm) && !targetAnnounced && r.clean) {
      targetAnnounced = true
      say('Tempo cible atteint 🎯', 'gold')
    }
    // Mémorisation progressive : deux passages propres retirent une aide, un raté en rend une
    if (memory.value === 'auto') {
      if (r.clean && ++memoryClean >= 2 && memoryLevel.value < 2) {
        memoryLevel.value++
        memoryClean = 0
        say(memoryLevel.value === 1 ? 'Mémoire · seule la note suivante reste' : 'Mémoire · de tête !', 'muted')
      } else if (!r.clean) {
        memoryClean = 0
        memoryLevel.value = Math.max(0, memoryLevel.value - 1)
      }
    }
    // Cycle des tonalités : après un passage propre, le phrasé change de tonalité
    if (keyCycle.value !== 'off' && r.clean && pass.kind !== 'burst') {
      const next = ((((transposeNow.value + (keyCycle.value === 'fourths' ? 5 : 1)) % 12) + 18) % 12) - 6
      transposeNow.value = next
      const first = transposed(next)[0]
      say(`Nouvelle tonalité · départ sur ${noteName(first.midi, notation.value)}`)
      const following = passes.get(i + 1)
      if (following && !following.events.length) passes.delete(i + 1)
    }
    // Tempo du passage suivant (rafale ou base)
    const nextPass = passes.get(i + 1)
    const nextKind = nextPass?.kind ?? passKind(i + 1)
    if (nextPass && !nextPass.events.length) nextPass.bpm = tempoFor(nextKind)
    setTempo(tempoFor(nextKind))
    prune(i)
  }
  // On garde les passages récents (affichage), on oublie les anciens
  function prune(i) {
    for (const k of passes.keys()) if (k < i - 1) passes.delete(k)
  }
  function finishPractice() {
    const p = phrase.value
    if (!p || !session) return
    if (session.passes) {
      const s = { at: session.at, duration: Math.round((Date.now() - session.at) / 1000), passes: session.passes, clean: session.clean, bestBpm: session.bestBpm, maxBpm: session.maxBpm, startBpm: session.startBpm }
      p.sessions = [...p.sessions, s].slice(-60)
      const q = sessionQuality(s, p)
      if (q !== null && s.passes >= 3) p.review = scheduleReview(p.review, q)
      const avg = session.scores.reduce((a, b) => a + b, 0) / session.scores.length
      summary.value = {
        ...s,
        endBpm: baseBpm.value,
        record: s.bestBpm > session.recordBefore && s.bestBpm > 0,
        avgScore: Math.round(avg),
        mastered: p.method === 'adaptive' ? masteredTempo(progress.reversals) : null,
        review: p.review ? reviewLabel(p) : null,
      }
      touch()
    }
    p.bpm = baseBpm.value || p.bpm
    session = null
    transposeNow.value = 0
  }
  // Le tempo choisi à la main au métronome pendant l'entraînement devient le tempo de base
  watch(metro.bpm, (v) => {
    if (mode.value !== 'practice' || !phrase.value || v === expectedBpm || shownPass.value?.kind === 'burst') return
    expectedBpm = v
    baseBpm.value = v
    phrase.value.bpm = v
  })
  function resetProgress() {
    const p = phrase.value
    p.bpm = p.startBpm
    metro.setBpm(p.startBpm)
    streak.value = 0
  }
  // Nouveau tempo de départ : la progression repart de là (et le métronome s'y règle)
  function setStartBpm(v) {
    const p = phrase.value
    p.startBpm = clampBpm(v)
    if (p.targetBpm < p.startBpm) p.targetBpm = p.startBpm
    resetProgress()
  }
  const setTargetBpm = (v) => (phrase.value.targetBpm = Math.max(phrase.value.startBpm, clampBpm(v)))
  // En changeant de phrasé, le métronome se met au tempo où on en est sur celui-ci
  watch(selectedId, () => {
    if (mode.value === 'idle' && phrase.value?.notes.length) metro.setBpm(phrase.value.bpm || phrase.value.startBpm)
  })

  /** Notes à venir pendant l'entraînement : la note à jouer et les deux suivantes. */
  const upcoming = computed(() => {
    if (mode.value !== 'practice' || now.value === null) return []
    const win = windowBeats()
    const out = []
    for (const k of [currentPass.value ?? 0, (currentPass.value ?? 0) + 1]) {
      const pass = passes.get(k)
      if (!pass || pass.kind === 'demo') continue
      for (const t of pass.targets) if (!t.state && t.beat + win >= now.value && out.length < 3) out.push(t)
    }
    return out
  })
  const nextTarget = computed(() => upcoming.value[0] ?? null)
  const demoPlaying = computed(() => mode.value === 'practice' && shownPass.value?.kind === 'demo')
  const clickMuted = computed(() => {
    if (mode.value !== 'practice' || gapClick.value === 'off' || now.value === null || counting.value) return false
    const bar = Math.floor(now.value / phrase.value.beats)
    return !!muteRule()?.(bar)
  })

  // ---------- Notes à l'écran ----------
  const shownNotes = computed(() => {
    if (mode.value === 'record') {
      if (!punch.value) return takes.value
      const { from, to } = punch.value
      return [...phrase.value.notes.filter((n) => n.beat < from - 1e-6 || n.beat >= to - 1e-6), ...takes.value].sort((a, b) => a.beat - b.beat)
    }
    return mode.value === 'practice' ? practiceNotes.value : (phrase.value?.notes ?? [])
  })
  const lengthBeats = computed(() => {
    const p = phrase.value
    if (!p) return 4
    if (mode.value === 'record' && !punch.value) {
      const elapsed = now.value !== null ? Math.max(0, now.value - countIn.value) : 0
      return Math.max(2 * p.beats, Math.ceil((elapsed + 0.01) / p.beats) * p.beats, loopLength(takes.value, p.beats, recordGrid.value))
    }
    return p.lengthBeats
  })
  /** Aide visuelle restante (mémorisation) : 0 tout, 1 la note suivante, 2 rien. */
  const memoryShown = computed(() => (mode.value === 'practice' ? memoryLevel.value : 0))
  const inSection = (n) => mode.value !== 'practice' || (n.beat >= section.value.from - 1e-6 && n.beat < section.value.to - 1e-6)

  /** État de la note i à l'écran : 'next' | 'soon' | 'hit' | 'miss' | 'selected' | 'idle' | 'dim' | 'hidden'. */
  function noteState(i) {
    const n = shownNotes.value[i]
    if (!n) return 'idle'
    if (mode.value === 'idle' && inSelection(i)) return 'selected'
    if (mode.value === 'practice') {
      if (!inSection(n)) return 'hidden'
      if (demoPlaying.value) {
        const pass = shownPass.value
        return pass.start + n.beat - section.value.from <= now.value ? 'hit' : memoryShown.value ? 'hidden' : 'idle'
      }
      const k = upcoming.value.findIndex((t) => t.index === i)
      if (counting.value) return i === firstIndex.value ? 'next' : memoryShown.value ? 'hidden' : 'idle'
      if (k === 0) return 'next'
      const state = shownPass.value?.targets.find((t) => t.index === i)?.state
      if (state) return state
      if (k > 0) return memoryShown.value >= 2 ? 'hidden' : 'soon'
      return memoryShown.value ? 'hidden' : 'idle'
    }
    if (mode.value === 'listen') return n.beat <= listenBeat.value ? 'hit' : 'idle'
    return 'idle'
  }
  const firstIndex = computed(() => shownNotes.value.findIndex(inSection))
  /** État de la technique de la note i à l'entraînement : 'ok' | 'miss' | 'idle' */
  function techState(i) {
    if (mode.value !== 'practice') return 'idle'
    return shownPass.value?.targets.find((t) => t.index === i)?.techState ?? 'idle'
  }

  const MARK_RANK = { next: 6, selected: 5, soon: 4, miss: 3, hit: 2, idle: 1, dim: 0 }
  const marks = computed(() => {
    const byPos = new Map()
    const states = shownNotes.value.map((_, i) => noteState(i))
    shownNotes.value.forEach((n, i) => {
      if (n.string === undefined || states[i] === 'hidden') return
      const key = `${n.string}-${n.fret}`
      const mk = byPos.get(key) ?? { string: n.string, fret: n.fret, text: noteName(n.midi, notation.value), order: [], state: 'dim' }
      mk.order.push(i + 1)
      if (MARK_RANK[states[i]] > MARK_RANK[mk.state]) mk.state = states[i]
      byPos.set(key, mk)
    })
    const out = [...byPos.values()].map((mk) => ({ ...mk, sub: memoryShown.value ? '' : mk.order.length > 3 ? `${mk.order.slice(0, 3).join('·')}…` : mk.order.join('·') }))
    // Power chords : la quinte et l'octave, en plus petit, du même état que la fondamentale
    shownNotes.value.forEach((n, i) => {
      if (n.chord !== 'power' || n.string === undefined || states[i] === 'hidden') return
      powerShape(n, tuning.value, frets.value).forEach((pos, k) => {
        if (byPos.has(`${pos.string}-${pos.fret}`)) return
        out.push({ ...pos, text: noteName(n.midi + (k ? 12 : 7), notation.value), sub: '', state: states[i], small: true })
      })
    })
    return out
  })
  // Liés, slides et bends dessinés sur le manche
  const links = computed(() => {
    const notes = shownNotes.value
    const out = []
    notes.forEach((n, i) => {
      const t = techOf(notes, i)
      const prev = notes[i - 1]
      if (!t || n.string === undefined || noteState(i) === 'hidden') return
      if (t.kind === 'bend') out.push({ kind: 'bend', from: n, label: bendLabel(n.bend) + (n.release ? ' r' : ''), state: techState(i) })
      else if (prev?.string !== undefined && noteState(i - 1) !== 'hidden') out.push({ kind: t.kind, from: prev, to: n, label: t.tag, state: techState(i) })
    })
    return out
  })

  // Frise : position de la tête de lecture (en temps du phrasé), ou null
  const playheadBeat = computed(() => {
    if (mode.value === 'listen') return Math.min(lengthBeats.value, listenBeat.value)
    if (now.value === null || counting.value) return null
    if (mode.value === 'record') return (punch.value?.from ?? 0) + Math.min(lengthBeats.value, now.value - countIn.value)
    if (mode.value === 'practice' && shownPass.value) {
      const r = now.value - shownPass.value.start
      return r >= 0 && r <= sectionLength.value ? section.value.from + r : null
    }
    return null
  })
  // Retour au début de la boucle : les bords de la frise s'animent juste avant (et au moment) où la tête repart
  const loopEdge = computed(() => {
    if (mode.value !== 'practice' || now.value === null || counting.value || currentPass.value === null) return null
    const k = Math.max(0, Math.floor((now.value - countIn.value) / period.value))
    const untilNext = passStart(k + 1) - now.value // temps avant le passage suivant
    const sinceStart = now.value - passStart(k)
    const rest = untilNext <= period.value - sectionLength.value + 1e-6 // pause entre deux passages
    return {
      soon: untilNext <= 1 || rest, // le curseur va revenir
      restart: sinceStart >= 0 && sinceStart < 0.5, // il vient de repartir
      count: rest && untilNext > 0 ? Math.ceil(untilNext) : 0, // temps de pause restants
      next: passKind(k + 1),
    }
  })

  // ---------- Édition ----------
  const selectedNote = ref(null) // index de la note sélectionnée (hors enregistrement / entraînement)
  const alignInfo = ref('') // résultat du calage auto
  const lastAlignMs = ref(0)
  const editable = computed(() => mode.value === 'idle' && !!phrase.value?.notes.length)
  const step = computed(() => gridStep(phrase.value?.grid ?? 4))

  function selectNote(i) {
    if (mode.value !== 'idle') return
    selectedNote.value = selectedNote.value === i ? null : i
  }
  // Plusieurs notes à la suite : Maj + clic étend la sélection depuis la note sélectionnée
  const selectionEnd = ref(null) // autre bout de la sélection, ou null (une seule note)
  watch(selectedNote, () => (selectionEnd.value = null), { flush: 'sync' })
  /** Notes sélectionnées : { from, to, count } (indices), ou null. */
  const selection = computed(() => {
    const a = selectedNote.value
    if (a === null || !phrase.value?.notes[a]) return null
    const b = Math.min(selectionEnd.value ?? a, phrase.value.notes.length - 1)
    return { from: Math.min(a, b), to: Math.max(a, b), count: Math.abs(a - b) + 1 }
  })
  const inSelection = (i) => !!selection.value && i >= selection.value.from && i <= selection.value.to
  function extendSelection(i) {
    if (mode.value !== 'idle') return
    if (selectedNote.value === null) selectedNote.value = i
    else selectionEnd.value = i === selectedNote.value ? null : i
  }
  const selected = computed(() => (selectedNote.value !== null ? (phrase.value?.notes[selectedNote.value] ?? null) : null))
  const alternates = computed(() => {
    const n = selected.value
    if (!n) return []
    return findPositions(n.midi, tuning.value, frets.value).filter((p) => p.string !== n.string || p.fret !== n.fret)
  })
  const selectedPlayed = computed(() => (selected.value ? { midi: selected.value.midi, string: selected.value.string, fret: selected.value.fret } : null))

  /** Applique de nouvelles notes (ordre et durée de boucle recalculés), en gardant de quoi annuler. */
  function setNotes(notes, label) {
    const p = phrase.value
    commit(label)
    const moved = selectedNote.value !== null ? notes[selectedNote.value] : null
    p.notes = [...notes].sort((a, b) => a.beat - b.beat)
    fitLength(p)
    if (moved) selectedNote.value = p.notes.indexOf(moved) // la note sélectionnée a pu changer de rang
  }
  function onFretClick({ string, fret, midi }) {
    if (mode.value !== 'idle' || !phrase.value) return
    if (entry.value) return enterNote({ string, fret, midi })
    const notes = phrase.value.notes
    const sel = selectedNote.value
    // Note sélectionnée + clic sur une autre position de la même note : on la déplace (et on la fige)
    if (sel !== null && notes[sel]?.midi === midi) {
      commit('Position')
      const id = notes[sel].id
      phrase.value.notes = place(notes.map((n, k) => (k === sel ? { ...n, string, fret, locked: true } : n)))
      selectedNote.value = phrase.value.notes.findIndex((n) => n.id === id)
      return
    }
    // Clic sur une note du phrasé -> sélection
    const i = notes.findIndex((n) => n.string === string && n.fret === fret)
    if (i >= 0 || sel === null) return void (selectedNote.value = i >= 0 ? (i === sel ? null : i) : null)
    // Note sélectionnée + clic sur une case libre : la note prend cette hauteur, à cette position
    setNoteAt(sel, { string, fret, midi })
  }
  // ---------- Saisie au manche : chaque clic sur une case ajoute la note suivante ----------
  const entry = ref(null) // { beat (curseur), dur (durée des notes saisies), ids (notes saisies, pour revenir) } ou null
  function toggleEntry() {
    if (entry.value) return void (entry.value = null)
    if (!phrase.value) createPhrase()
    stopAll()
    const p = phrase.value
    if (!p.notes.length) {
      p.beats = metro.beats.value
      p.grid = metro.subdiv.value
      p.recordBpm = metro.bpm.value
    }
    // Le curseur part après la dernière note
    const last = p.notes.at(-1)
    const beat = last ? last.beat + Math.max(noteLength(p.notes, p.notes.length - 1, p.lengthBeats), gridStep(p.grid)) : 0
    selectedNote.value = null
    boardOpen.value = true // la saisie se fait en cliquant le manche
    entry.value = { beat: quantize(beat, p.grid), dur: entry.value?.dur ?? Math.max(gridStep(p.grid), 0.5), ids: [] }
  }
  function enterNote({ string, fret, midi }) {
    const p = phrase.value
    const e = entry.value
    commit('Saisie')
    // Durée qui ne tombe pas sur la grille (triolets dans un phrasé en croches…) : grille mixte
    if (Math.abs(e.dur * p.grid - Math.round(e.dur * p.grid)) > 1e-6 && Math.abs(e.beat * p.grid - Math.round(e.beat * p.grid)) > 1e-6) p.grid = GRID_MIX
    while (occupied(e.beat, -1)) e.beat += e.dur
    const id = uid()
    p.notes = place([...p.notes, { id, midi, beat: e.beat, dur: e.dur, string, fret, locked: true }])
    fitLength(p)
    e.ids.push(id)
    e.beat += e.dur
    showPlayed(midi, { string, fret })
    previewNote({ midi })
  }
  /** Saisie : un silence (le curseur avance d'une durée) */
  const entryRest = () => entry.value && (entry.value.beat += entry.value.dur)
  /** Saisie : retire la dernière note saisie et recule le curseur */
  function entryBack() {
    const e = entry.value
    const id = e?.ids.pop()
    if (!id) return
    const p = phrase.value
    const n = p.notes.find((m) => m.id === id)
    commit('Saisie')
    p.notes = p.notes.filter((m) => m.id !== id)
    fitLength(p)
    if (n) e.beat = n.beat
  }
  watch(mode, (m) => m !== 'idle' && (entry.value = null))

  /** Donne à la note i une nouvelle case (et donc une nouvelle hauteur). */
  function setNoteAt(i, { string, fret, midi }) {
    const n = phrase.value.notes[i]
    commit(midi === n.midi ? 'Position' : 'Hauteur')
    phrase.value.notes = place(phrase.value.notes.map((m, k) => (k === i ? { ...m, midi, string, fret, locked: true } : m)))
    selectedNote.value = phrase.value.notes.findIndex((m) => m.id === n.id)
  }
  /** Monte ou descend la note sélectionnée de `semis` demi-tons (même corde si possible). */
  /** Monte ou descend les notes sélectionnées de `semis` demi-tons (même corde si possible). */
  function shiftPitch(semis) {
    const { from, to } = selection.value
    const notes = phrase.value.notes
    const moved = []
    for (let i = from; i <= to; i++) {
      const n = notes[i]
      const midi = n.midi + semis
      const fret = n.fret + semis
      const pos = fret >= 0 && fret <= frets.value ? { string: n.string, fret } : nearestPosition(midi, n)
      if (!pos) return say('Hors du manche : impossible d’aller plus loin', 'muted')
      moved.push({ ...n, midi, string: pos.string, fret: pos.fret, locked: true })
    }
    commit('Hauteur')
    phrase.value.notes = place(notes.map((n, k) => (k >= from && k <= to ? moved[k - from] : n)))
  }
  /**
   * Rythme des notes sélectionnées : elles se suivent en noires (1), croches (2), triolets (3) ou doubles
   * croches (4) à partir de la première ; la suite du phrasé avance ou recule d'autant.
   */
  function setRhythm(sub) {
    const p = phrase.value
    const { from, to } = selection.value
    const notes = p.notes
    const step = 1 / sub
    // Départ sur la nouvelle subdivision (sans passer avant la note précédente)
    let start = Math.round(notes[from].beat * sub) / sub
    if (from > 0 && start <= notes[from - 1].beat + 1e-6) start = Math.ceil(notes[from].beat * sub - 1e-6) / sub
    const run = notes.slice(from, to + 1).map((n, k) => ({ ...n, beat: start + k * step, dur: step, raw: undefined }))
    const shift = (d) => notes.slice(to + 1).map((n) => ({ ...n, beat: n.beat + d, raw: n.raw !== undefined ? n.raw + d : undefined }))
    // La suite suit la fin des notes réécrites ; si elle tomberait entre deux cases (ou dans un temps à la fois
    // binaire et ternaire), elle recule moins : le plus petit décalage qui la garde sur une case, la dernière
    // note réécrite étant alors tenue jusqu'à elle (pas de petit silence)
    const delta = run.at(-1).beat + step - (notes[to].beat + noteLength(notes, to, p.lengthBeats))
    let d = delta
    if (to + 1 < notes.length) {
      const shifts = [1 / 12, 1 / 4, 1 / 3, 1 / 2, 1].map((u) => Math.ceil(delta / u - 1e-6) * u).sort((a, b) => a - b)
      d = shifts.find((x) => onGrid([...run, ...shift(x)], GRID_MIX)) ?? Math.ceil(delta - 1e-6)
      run.at(-1).dur = step + d - delta
    }
    const rest = shift(d)
    const all = [...notes.slice(0, from), ...run, ...rest]
    // Grille : celle du phrasé si tout y tombe, sinon la plus simple qui convient (mixte en dernier)
    const grid = [p.grid, 1, 2, 3, 4].find((g) => g !== GRID_MIX && onGrid(all, g)) ?? GRID_MIX
    commit('Rythme')
    p.grid = grid
    p.notes = all
    fitLength(p)
  }
  /** Ajoute une note (case donnée, ou à défaut la même que la note voisine) au temps `beat`. */
  function addNote(beat, string = null, fret = null) {
    const p = phrase.value
    const b = Math.max(0, quantize(beat, p.grid))
    if (occupied(b, -1)) return say('Une note occupe déjà cette case', 'muted')
    const near = [...p.notes].reverse().find((n) => n.beat <= b) ?? p.notes[0]
    const s = string ?? near?.string ?? 0
    const f = fret ?? (string !== null && near?.string !== string ? Math.max(0, Math.min(frets.value, (near?.midi ?? tuning.value[s] + 5) - tuning.value[s])) : (near?.fret ?? 5))
    commit('Ajout')
    const id = uid()
    p.notes = place([...p.notes, { id, midi: tuning.value[s] + f, beat: b, dur: step.value, string: s, fret: f, locked: true }])
    fitLength(p)
    selectedNote.value = p.notes.findIndex((n) => n.id === id)
  }
  /** Ajoute une note juste après la note sélectionnée (ou à la fin). */
  function addNoteAfter() {
    const p = phrase.value
    const from = selected.value ?? p.notes.at(-1)
    let b = from ? stepBeat(from.beat, 1, p.grid) : 0
    while (occupied(b, -1)) b = stepBeat(b, 1, p.grid)
    addNote(b, from?.string ?? null, from?.fret ?? null)
  }
  function deleteNote() {
    const p = phrase.value
    commit('Suppression')
    p.notes = p.notes.filter((_, i) => !inSelection(i))
    fitLength(p)
    selectedNote.value = null
  }
  function autoPlace() {
    commit('Doigté')
    phrase.value.notes = place(phrase.value.notes.map(({ locked, ...n }) => n))
  }
  function setZone(zone) {
    const p = phrase.value
    commit('Position du doigté')
    p.zone = zone
    p.notes = place(
      p.notes.map(({ locked, ...n }) => n),
      p,
    )
  }
  /** Transpose le phrasé lui-même (pas seulement l'entraînement). */
  function transposePhrase(semis) {
    const p = phrase.value
    const notes = p.notes.map((n) => ({ ...n, midi: n.midi + semis, locked: false }))
    if (!fits(notes)) return say('Hors du manche : impossible de transposer plus loin', 'muted')
    commit('Transposition')
    p.notes = place(notes)
    say(`Transposé · départ sur ${noteName(p.notes[0].midi, notation.value)}`)
  }
  // Autre accordage : les positions sont recalculées
  watch(tuningId, () => {
    for (const p of phrases.value) p.notes = placeNotes(p.notes, tuning.value, frets.value, { zone: p.zone })
  })
  // Une note par case : la détection n'entend qu'une note à la fois
  const occupied = (beat, except) => phrase.value.notes.some((n, k) => k !== except && Math.abs(n.beat - beat) < 1e-6)
  /** Déplace la note sélectionnée d'une case ; sur une case prise, elle échange sa place avec la voisine. */
  function nudge(dir) {
    if (selection.value.count > 1) return
    const i = selectedNote.value
    const notes = phrase.value.notes
    const beat = stepBeat(notes[i].beat, dir, phrase.value.grid)
    if (beat < -1e-6) return
    const j = notes.findIndex((n, k) => k !== i && Math.abs(n.beat - beat) < 1e-6)
    setNotes(
      notes.map((m, k) => (k === i ? { ...m, beat, raw: undefined } : k === j ? { ...m, beat: notes[i].beat, raw: undefined } : m)),
      'Déplacement',
    )
  }
  function shiftPhrase(dir) {
    const notes = shiftAll(phrase.value.notes, dir * step.value)
    if (notes) setNotes(notes, 'Décalage')
  }
  function runAutoAlign() {
    const p = phrase.value
    const { notes, offset } = autoAlign(p.notes, p.grid, p.recordBpm)
    const ms = Math.round((offset * 60000) / p.recordBpm)
    setNotes(notes, 'Calage auto')
    alignInfo.value = Math.abs(ms) < 8 ? 'Déjà calé : rien à corriger.' : `Recalé : tu jouais en moyenne ${Math.abs(ms)} ms ${ms > 0 ? 'en retard' : 'en avance'}.`
    lastAlignMs.value = ms
  }
  // Le retard mesuré vient souvent du micro : on peut l'ajouter au réglage Calage pour les prochaines prises
  function applyToLatency() {
    latency.value = Math.min(250, Math.max(0, latency.value + lastAlignMs.value))
    lastAlignMs.value = 0
  }
  function changeGrid(grid) {
    const p = phrase.value
    commit('Grille')
    p.grid = grid
    p.notes = requantize(p.notes, grid, p.recordBpm).sort((a, b) => a.beat - b.beat)
    fitLength(p)
    alignInfo.value = ''
  }

  // Glisser sur la frise : la page appelle beginDrag, dragTo (en direct), puis endDrag
  let dragBefore = null
  function beginDrag() {
    dragBefore = snapshot('Déplacement')
  }
  /** Pendant le glisser : nouvelle position (beat), durée (dur) ou corde (string) de la note i. */
  function dragTo(i, { beat, dur, string }) {
    const p = phrase.value
    const n = p.notes[i]
    if (!n) return
    if (dur !== undefined) {
      // Durée : au moins une case, jusqu'à la note suivante (ou une mesure après la fin de la boucle)
      const next = p.notes.find((m) => m.beat > n.beat + 1e-6)?.beat ?? p.lengthBeats + p.beats
      const d = Math.min(next - n.beat, Math.max(step.value, quantize(dur, p.grid === GRID_MIX ? 4 : p.grid)))
      if (d !== n.dur) p.notes[i] = { ...n, dur: d }
      dragBefore.label = 'Durée'
      return
    }
    if (string !== undefined && string !== n.string) {
      const fret = n.midi - tuning.value[string]
      if (fret >= 0 && fret <= frets.value) {
        p.notes[i] = { ...p.notes[i], string, fret, locked: true }
        dragBefore.label = 'Corde'
      }
    }
    if (beat !== undefined) {
      const b = Math.min(p.lengthBeats + p.beats - step.value, quantize(beat, p.grid))
      if (b !== p.notes[i].beat && !occupied(b, i)) p.notes[i] = { ...p.notes[i], beat: b, raw: undefined }
    }
  }
  function endDrag(moved) {
    const before = dragBefore
    dragBefore = null
    if (!moved || !before) return
    // Fin du glisser : on remet les notes dans l'ordre, on recalcule le doigté des autres, et on garde de quoi annuler
    const p = phrase.value
    const id = p.notes[selectedNote.value]?.id
    remember(before)
    p.notes = before.label === 'Corde' ? place(p.notes) : [...p.notes].sort((a, b) => a.beat - b.beat)
    fitLength(p)
    if (id) selectedNote.value = p.notes.findIndex((n) => n.id === id)
    touch()
  }

  // ---------- Techniques (correction à la main) ----------
  const selTech = computed(() => (selected.value ? (selected.value.bend ? 'bend' : (selected.value.tech ?? null)) : null))
  const legatoName = computed(() => {
    const notes = phrase.value?.notes ?? []
    const i = selectedNote.value
    if (!i || !notes[i - 1]) return 'Lié'
    return notes[i].midi > notes[i - 1].midi ? 'Hammer-on' : notes[i].midi < notes[i - 1].midi ? 'Pull-off' : 'Lié'
  })
  function editNote(patch, label = 'Technique') {
    const i = selectedNote.value
    commit(label)
    phrase.value.notes = phrase.value.notes.map((n, k) => (k === i ? { ...n, ...patch } : n))
  }
  function setTech(kind, steps = 0) {
    if (kind === 'bend') editNote({ tech: null, bend: steps, release: selected.value.release })
    else editNote({ tech: kind, bend: 0, release: false })
  }
  const toggleRelease = () => editNote({ release: !selected.value.release })
  const togglePalmMute = () => editNote({ pm: !selected.value.pm }, 'Palm mute')
  function togglePower() {
    const id = selected.value.id
    editNote({ chord: selected.value.chord === 'power' ? null : 'power', locked: false }, 'Power chord')
    // La fondamentale doit laisser la place à la quinte : le doigté est recalculé
    phrase.value.notes = place(phrase.value.notes)
    selectedNote.value = phrase.value.notes.findIndex((n) => n.id === id)
  }

  // ---------- Motifs : copier une section, la répéter, la coller ----------
  const clipboard = ref(null) // { notes (temps relatifs au début du motif), length (temps) }
  /** La section délimitée sur la règle, comme motif. */
  function sectionClip() {
    const p = phrase.value
    if (!p?.loop) return null
    const { from, to } = section.value
    const notes = p.notes.filter((n) => n.beat >= from - 1e-6 && n.beat < to - 1e-6).map((n) => ({ ...n, beat: n.beat - from }))
    return notes.length ? { notes, length: to - from } : null
  }
  /** Insère un motif au temps `at` : les notes suivantes reculent de sa longueur. */
  function insertClip(at, clip, times, label) {
    const p = phrase.value
    const span = clip.length * times
    commit(label)
    const moved = p.notes.map((n) => (n.beat >= at - 1e-6 ? { ...n, beat: n.beat + span, raw: n.raw !== undefined ? n.raw + span : undefined } : n))
    const copies = []
    for (let k = 0; k < times; k++) for (const n of clip.notes) copies.push({ ...n, id: uid(), beat: at + k * clip.length + n.beat, raw: undefined })
    p.notes = place([...moved, ...copies])
    fitLength(p)
    selectedNote.value = null
  }
  function copySection() {
    const clip = sectionClip()
    if (!clip) return say('Délimite d’abord une section sur la règle', 'muted')
    clipboard.value = clip
    say(`Motif copié · ${clip.notes.length} note${clip.notes.length > 1 ? 's' : ''}`)
  }
  /** Répète la section juste après elle-même. */
  function repeatSection(times = 1) {
    const clip = sectionClip()
    if (!clip) return say('Délimite d’abord une section sur la règle', 'muted')
    insertClip(section.value.to, clip, times, 'Répétition')
    say(times > 1 ? `Motif répété ${times} fois` : 'Motif répété')
  }
  /** Colle le motif copié : au curseur de saisie, après la note sélectionnée, sinon à la fin du phrasé. */
  function pasteClip() {
    const clip = clipboard.value
    const p = phrase.value
    if (!clip || !p) return
    let at
    if (entry.value) at = entry.value.beat
    else if (selected.value) at = Math.ceil(selected.value.beat + noteLength(p.notes, selectedNote.value, p.lengthBeats) - 1e-6)
    else at = p.notes.length ? Math.ceil(Math.max(...p.notes.map((n, i) => n.beat + noteLength(p.notes, i, p.lengthBeats))) - 1e-6) : 0
    insertClip(at, clip, 1, 'Collage')
    if (entry.value) entry.value.beat += clip.length
    say('Motif collé')
  }

  // ---------- Longueur : des mesures vides au bout, pour écrire plus loin ----------
  const MAX_BARS = 32
  /** Durée de la boucle : les mesures qui contiennent les notes, au moins celles ajoutées à la main. */
  function fitLength(p = phrase.value) {
    p.lengthBeats = Math.max(loopLength(p.notes, p.beats, p.grid), (p.minBars ?? 0) * p.beats)
  }
  const canAddBar = computed(() => mode.value === 'idle' && !!phrase.value && phrase.value.lengthBeats / phrase.value.beats < MAX_BARS)
  // On ne retire qu'une mesure vide, au bout
  const canRemoveBar = computed(() => {
    const p = phrase.value
    return mode.value === 'idle' && !!p && p.lengthBeats > p.beats && p.lengthBeats - p.beats >= loopLength(p.notes, p.beats, p.grid) - 1e-6
  })
  function addBar() {
    if (!canAddBar.value) return
    const p = phrase.value
    commit('Mesure ajoutée')
    p.minBars = Math.round(p.lengthBeats / p.beats) + 1
    fitLength(p)
  }
  function removeBar() {
    if (!canRemoveBar.value) return
    const p = phrase.value
    commit('Mesure retirée')
    p.minBars = Math.round(p.lengthBeats / p.beats) - 1
    fitLength(p)
    if (p.loop && p.loop.to > p.lengthBeats) setLoop(p.loop.from, p.lengthBeats)
  }

  // ---------- Section travaillée en boucle ----------
  function setLoop(from, to) {
    const p = phrase.value
    if (!p) return
    const a = Math.max(0, Math.min(from, to))
    const b = Math.min(p.lengthBeats, Math.max(from, to))
    p.loop = b - a >= 0.5 ? { from: a, to: b } : null // tout le phrasé compris (motif à copier entier)
  }
  const clearLoop = () => phrase.value && (phrase.value.loop = null)
  const selectAll = () => phrase.value && setLoop(0, phrase.value.lengthBeats)

  // ---------- Analyse ----------
  const profile = computed(() => (phrase.value ? noteProfile(phrase.value.notes, phrase.value.noteStats) : []))
  const spot = computed(() => (phrase.value ? hardSpot(phrase.value.notes, phrase.value.noteStats, phrase.value.lengthBeats) : null))
  const drifts = computed(() => (phrase.value ? timingDrifts(phrase.value.notes, phrase.value.noteStats) : []))
  const forecast = computed(() => (phrase.value ? projection(phrase.value.sessions, phrase.value.targetBpm) : null))
  const masteryPct = computed(() => (phrase.value ? mastery(phrase.value) : 0))
  function workOnSpot() {
    if (!spot.value) return
    setLoop(spot.value.from, spot.value.to)
    view.value = 'practice'
    say(`Boucle sur les notes ${spot.value.start + 1} à ${spot.value.end + 1}`)
  }

  // ---------- Calibration du micro : une note sur chaque clic ----------
  const calibration = ref(null) // { offsets: [ms], result: { ms, spread } | null } ; null : fenêtre fermée
  const CALIBRATION_NOTES = 8
  let calibrationBpm = 0
  function openCalibration() {
    stopAll()
    calibration.value = { offsets: [], result: null }
  }
  async function startCalibration() {
    stopAll()
    ensureAudio()
    calibration.value = { offsets: [], result: null }
    calibrationBpm = metro.bpm.value
    metro.setBpm(90)
    await metro.start()
    run('calibrate')
  }
  function calibrateNote(n) {
    const b = metro.beatAt(n.at ?? performance.now()) // sans calage : c'est lui qu'on mesure
    if (b === null || b < countIn.value - 0.4) return
    const ms = (b - Math.round(b)) * (60000 / metro.bpm.value)
    if (Math.abs(ms) > 300) return
    calibration.value.offsets.push(ms)
    if (calibration.value.offsets.length >= CALIBRATION_NOTES) stopAll()
  }
  function calibrateTick() {
    if (now.value !== null && now.value > countIn.value + CALIBRATION_NOTES + 6) stopAll()
  }
  function finishCalibration() {
    const offsets = calibration.value?.offsets ?? []
    metro.setBpm(calibrationBpm)
    if (offsets.length >= 4) {
      const sorted = [...offsets].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      const spread = [...offsets.map((o) => Math.abs(o - med))].sort((a, b) => a - b)[Math.floor(offsets.length / 2)]
      calibration.value.result = { ms: Math.round(Math.max(0, med)), spread: Math.round(spread) }
    } else if (calibration.value) calibration.value.result = { ms: null, spread: null }
  }
  function applyCalibration() {
    const r = calibration.value?.result
    if (r?.ms !== null && r?.ms !== undefined) {
      latency.value = Math.min(250, r.ms)
      say(`Calage réglé · ${latency.value} ms`)
    }
    calibration.value = null
  }
  const closeCalibration = () => {
    if (mode.value === 'calibrate') stopAll()
    calibration.value = null
  }

  // ---------- Clavier ----------
  function onKey(e) {
    if (e.target.closest?.('input, select, textarea')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.shiftKey ? redo() : undo()
      return e.preventDefault()
    }
    // Copier / coller un motif (la section délimitée sur la règle)
    if (mod && (e.key === 'c' || e.key === 'v') && mode.value === 'idle' && phrase.value && !getSelection()?.toString()) {
      e.key === 'c' ? copySection() : pasteClip()
      return e.preventDefault()
    }
    if (mod || e.altKey) return
    const big = e.shiftKey ? 5 : 1
    if (e.code === 'Space') mode.value === 'idle' ? (phrase.value?.notes.length ? startPractice() : startRecording()) : stopAll()
    else if (e.key === 'r' || e.key === 'R') mode.value === 'record' ? stopAll() : startRecording()
    else if (e.key === 'l' || e.key === 'L') mode.value === 'free' ? stopAll() : startFreeTake()
    else if (e.key === 'Escape') mode.value !== 'idle' ? stopAll() : helpOpen.value ? (helpOpen.value = false) : entry.value ? (entry.value = null) : (selectedNote.value = null)
    else if (e.key === 'Backspace' && entry.value) entryBack()
    else if (e.key === '?') helpOpen.value = !helpOpen.value
    else if (e.key === 'm' || e.key === 'M') boardOpen.value = !boardOpen.value
    else if (e.key === '1' || e.key === '2' || e.key === '3') view.value = ['studio', 'practice', 'progress'][e.key - 1]
    else if (e.key === 'ArrowUp') metro.setBpm(metro.bpm.value + big)
    else if (e.key === 'ArrowDown') metro.setBpm(metro.bpm.value - big)
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && editable.value && (selectedNote.value !== null || e.shiftKey)) {
      // Note sélectionnée : ← → la déplacent d'une case ; Maj + ← → décalent tout le phrasé
      const dir = e.key === 'ArrowRight' ? 1 : -1
      e.shiftKey ? shiftPhrase(dir) : nudge(dir)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && mode.value !== 'record') metro.stepSubdiv(e.key === 'ArrowRight' ? 1 : -1)
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNote.value !== null && editable.value) deleteNote()
    else return
    e.preventDefault()
  }

  // Page affichée : clavier ; en partant on arrête tout, on libère le micro et on sauvegarde
  const active = ref(false)
  onActivated(() => {
    reloadShared()
    active.value = true
    addEventListener('keydown', onKey)
  })
  onDeactivated(() => {
    active.value = false
    removeEventListener('keydown', onKey)
    stopAll()
    audio.stop()
    flushSave()
  })
  onBeforeUnmount(() => {
    removeEventListener('keydown', onKey)
    removeEventListener('fb:settings', reloadShared)
    stopAll()
    audio.stop()
    metro.dispose()
    flushSave()
  })

  return reactive({
    // réglages
    tuningId,
    tuning,
    notation,
    labelMode,
    frets,
    showAlternates,
    bodyFinish,
    matchHead,
    latency,
    toleranceId,
    toleranceMs,
    requireTech,
    autoLatency,
    memory,
    gapClick,
    demo,
    keyCycle,
    guideVolume,
    view,
    libraryOpen,
    boardOpen,
    settingsOpen,
    helpOpen,
    active,
    // bibliothèque
    phrases,
    selectedId,
    phrase,
    createPhrase,
    selectPhrase,
    confirmDelete,
    deletePhrase,
    duplicatePhrase,
    exportCurrent,
    exportAll,
    importFile,
    importError,
    gpFile,
    addImported,
    // moteurs (refs brutes : le métronome et l'entrée audio gardent leurs refs)
    metro: markRaw(metro),
    audio: markRaw(audio),
    // déroulé
    mode,
    now, // aussi lu par les tests
    clock,
    counting,
    countdown,
    stopAll,
    onNote, // aussi appelé par les tests et le débogage : une note « jouée »
    played,
    // enregistrement
    takes,
    punch,
    startRecording,
    startPunch,
    freeCount,
    freeStart,
    freeResult,
    startFreeTake,
    reinterpret,
    // écoute
    listen,
    previewNote,
    // entraînement
    passes,
    results,
    streak,
    transposeNow,
    lastAdjust,
    lastOffset,
    summary,
    toast,
    section,
    sectionLength,
    shownPass,
    demoPlaying,
    clickMuted,
    startPractice,
    resetProgress,
    setStartBpm,
    setTargetBpm,
    // affichage
    shownNotes,
    lengthBeats,
    memoryShown,
    noteState,
    techState,
    marks,
    links,
    playheadBeat,
    loopEdge,
    // édition
    selectedNote,
    selected,
    selectNote,
    selection,
    extendSelection,
    setRhythm,
    alternates,
    selectedPlayed,
    editable,
    onFretClick,
    shiftPitch,
    addNote,
    addNoteAfter,
    entry,
    toggleEntry,
    entryRest,
    entryBack,
    deleteNote,
    autoPlace,
    setZone,
    transposePhrase,
    shiftPhrase,
    runAutoAlign,
    alignInfo,
    lastAlignMs,
    applyToLatency,
    changeGrid,
    beginDrag,
    dragTo,
    endDrag,
    selTech,
    legatoName,
    setTech,
    toggleRelease,
    togglePalmMute,
    togglePower,
    past,
    future,
    undo,
    redo,
    // longueur
    canAddBar,
    canRemoveBar,
    addBar,
    removeBar,
    // section
    setLoop,
    clearLoop,
    selectAll,
    clipboard,
    copySection,
    repeatSection,
    pasteClip,
    // analyse
    profile,
    spot,
    drifts,
    forecast,
    masteryPct,
    workOnSpot,
    // calibration
    calibration,
    openCalibration,
    startCalibration,
    applyCalibration,
    closeCalibration,
  })
}
