<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import Fretboard from './components/Fretboard.vue'
import Tuner from './components/Tuner.vue'
import Metronome from './components/Metronome.vue'
import ComboAnnouncement from './components/ComboAnnouncement.vue'
import FinisherFight from './components/finishers/FinisherFight.vue'
import { createTrackSession, recordEvent, sessionResult } from './lib/finisher'
import Icon from './components/Icon.vue'
import Dropdown from './components/ui/Dropdown.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ListenButton from './components/ListenButton.vue'
import SpotifyPlayer from './components/SpotifyPlayer.vue'
import LoaderNeck from './components/loaders/LoaderNeck.vue'
import GameMode from './components/game/GameMode.vue'
import { useAudioInput } from './composables/useAudioInput'
import { useCombo } from './composables/useCombo'
import {
  ARPEGGIOS,
  NOTE_NAMES,
  SCALES,
  findTuning,
  buildOverlay,
  findPositions,
  noteName,
  pitchClass,
} from './lib/music'
import { keyFromTitle } from './lib/keyFromTitle'
import { DEFAULT_BODY_FINISH, applyAccent } from './lib/noteStyles'
import { positionKey, scaleBoxes } from './lib/boxes'
import { CHORDS, chordShapes, scaleChords } from './lib/chords'
import { practiceRequest } from './lib/practice'
import { PHRASE_GAP_MS, PHRASE_LENGTH, REVISABLE, bestFingering, handFrom, rootBox } from './lib/fingering'
import { persisted, reloadPersisted } from './lib/storage'

const settingsOpen = ref(false) // panneau ⚙ (entrée audio, guitare, affichage)
const props = defineProps({ skipSplash: { type: Boolean, default: false } })
// Animation de chargement au lancement, mais pas en revenant de l'onglet Ampli
const splash = ref(!props.skipSplash)
const overlayType = persisted('overlayType', 'scale') // 'scale' | 'arpeggio' | 'chord' | 'none'
const root = persisted('root', 9) // La
const scaleId = persisted('scaleId', 'penta-minor')
const arpeggioId = persisted('arpeggioId', 'm7')
const chordId = persisted('chordId', 'maj')
const notation = persisted('notation', 'fr')
const labelMode = persisted('labelMode', 'note')
const frets = persisted('frets', 22)
const showAlternates = persisted('showAlternates', true)
const bodyFinish = persisted('bodyFinish', DEFAULT_BODY_FINISH)
const matchHead = persisted('matchHead', false)
watch(bodyFinish, applyAccent, { immediate: true }) // le thème du site suit la finition de la guitare
const boxIndex = persisted('boxIndex', 0) // 0 = tout le manche, sinon numéro de la box

// Guitare : 6 ou 7 cordes, et accordage
const tuningId = persisted('tuning', 'standard')
const tuning = computed(() => findTuning(tuningId.value).notes)

// Réglages changés ailleurs (page Phrasés, ou compte synchronisé depuis un autre appareil) : on les relit
const reloadSettings = () => reloadPersisted({ tuning: tuningId, notation, labelMode, frets, showAlternates, bodyFinish, matchHead })
addEventListener('fb:settings', reloadSettings)

const pattern = computed(() => {
  if (overlayType.value === 'scale') return SCALES.find((s) => s.id === scaleId.value)
  if (overlayType.value === 'arpeggio') return ARPEGGIOS.find((a) => a.id === arpeggioId.value)
  if (overlayType.value === 'chord') return CHORDS.find((c) => c.id === chordId.value)
  return null
})
const isChord = computed(() => overlayType.value === 'chord')

// Titre cliquable : la tonique et la gamme / l'arpège / l'accord se choisissent directement dedans
const OVERLAY_TYPES = [
  { id: 'scale', label: 'Gamme' },
  { id: 'arpeggio', label: 'Arpège' },
  { id: 'chord', label: 'Accord' },
  { id: 'none', label: 'Aucun' },
]
const rootOptions = computed(() => NOTE_NAMES[notation.value].map((label, value) => ({ value, label })))
const patternModel = computed({
  get: () => (overlayType.value === 'scale' ? scaleId.value : overlayType.value === 'arpeggio' ? arpeggioId.value : chordId.value),
  set: (v) => (overlayType.value === 'scale' ? (scaleId.value = v) : overlayType.value === 'arpeggio' ? (arpeggioId.value = v) : (chordId.value = v)),
})
const patternOptions = computed(() => (overlayType.value === 'scale' ? SCALES : overlayType.value === 'arpeggio' ? ARPEGGIOS : CHORDS).map((p) => ({ value: p.id, label: p.name })))

// « Pratiquer sur le manche » depuis un cours de la page Théorie : on règle la gamme / l'accord du cours
watch(
  practiceRequest,
  (r) => {
    if (!r) return
    const refs = { overlayType, root, scaleId, arpeggioId, chordId, boxIndex }
    Object.entries(r).forEach(([k, v]) => refs[k] && (refs[k].value = v))
    practiceRequest.value = null
  },
  { immediate: true },
)
const overlay = computed(() => buildOverlay(root.value, pattern.value))
// Manche affiché : « Aucun » montre toutes les notes, sans tonique ni degré (le jeu et les combos gardent l'overlay vide)
const ALL_NOTES = new Map(Array.from({ length: 12 }, (_, pc) => [pc, { interval: null, degree: '', isRoot: false }]))
const boardOverlay = computed(() => (pattern.value ? overlay.value : ALL_NOTES))
// Boxes de la gamme courante (ou formes CAGED de l'accord) ; la box choisie restreint l'affichage et la détection de position
const boxes = computed(() => (isChord.value ? chordShapes(root.value, pattern.value, tuning.value, frets.value) : scaleBoxes(root.value, pattern.value, tuning.value, frets.value)))

// Accords de la gamme : un clic met les notes de l'accord en avant sur la gamme
const harmony = computed(() => (overlayType.value === 'scale' ? scaleChords(root.value, pattern.value) : []))
const harmonyIndex = ref(null)
const harmonyChord = computed(() => harmony.value[harmonyIndex.value] ?? null)
watch([root, scaleId, overlayType], () => (harmonyIndex.value = null))
const chordLabel = (c) => `${NOTE_NAMES[notation.value][c.root]}${c.symbol}`
/** Ouvre l'accord mis en avant en mode Accord, pour voir ses formes. */
function showChordShapes(c) {
  const id = CHORDS.some((x) => x.id === c.id) ? c.id : null
  if (!id) return
  overlayType.value = 'chord'
  chordId.value = id
  root.value = c.root
  boxIndex.value = 0
}
const activeBox = computed(() => (boxIndex.value ? boxes.value[boxIndex.value - 1] ?? null : null))
watch(boxes, (b) => {
  if (boxIndex.value > b.length) boxIndex.value = 0
})
const boxLabel = (b) => b.ranges.map(([lo, hi]) => `${lo}–${hi}`).join(' · ')

const overlayTitle = computed(() =>
  pattern.value ? `${NOTE_NAMES[notation.value][root.value]} ${pattern.value.name}` : 'Aucune gamme',
)

// Recherche Spotify proposée selon la tonalité choisie (ex. « A minor backing track »)
const backingSuggestion = computed(() => {
  if (!pattern.value) return 'guitar backing track'
  const minor = pattern.value.intervals.includes(3) && !pattern.value.intervals.includes(4)
  return `${NOTE_NAMES.en[root.value]} ${minor ? 'minor' : 'major'} backing track`
})

// ---------- Tonalité suivant le morceau Spotify ----------
const quality = (p) => (p.intervals.includes(3) && !p.intervals.includes(4) ? 'minor' : 'major')
const keySync = shallowRef(null) // { title, state } : réglage appliqué d'après le morceau

function onTrackChange(track) {
  // Titre d'abord, puis nom de l'album (souvent « Backing Tracks in A minor »)
  const key = keyFromTitle(track.name) ?? keyFromTitle(track.album)
  if (!key) return // rien de fiable : on garde la gamme choisie

  root.value = key.root
  if (key.scale) {
    overlayType.value = 'scale'
    scaleId.value = key.scale
  } else if (key.quality) {
    // On garde le type de gamme / d'arpège choisi s'il a déjà la bonne couleur (ex. blues pour un morceau mineur)
    if (overlayType.value === 'arpeggio') {
      const current = ARPEGGIOS.find((a) => a.id === arpeggioId.value)
      if (quality(current) !== key.quality) arpeggioId.value = key.quality === 'minor' ? 'm7' : 'maj7'
    } else if (overlayType.value === 'chord') {
      const current = CHORDS.find((c) => c.id === chordId.value)
      if (!current.power && quality(current) !== key.quality) chordId.value = key.quality === 'minor' ? 'min' : 'maj'
    } else {
      const current = SCALES.find((sc) => sc.id === scaleId.value)
      overlayType.value = 'scale'
      if (quality(current) !== key.quality) scaleId.value = key.quality === 'minor' ? 'penta-minor' : 'penta-major'
    }
  }
  keySync.value = { title: track.name, state: syncState() }
}

const syncState = () => [overlayType.value, root.value, scaleId.value, arpeggioId.value, chordId.value].join('|')
// L'indication disparaît dès que la gamme est changée à la main
const keySyncActive = computed(() => keySync.value && keySync.value.state === syncState())

// ---------- Combo ----------
// Statistiques par backing track, pour l'écran « FINISH! » de fin de morceau
const trackSessions = {} // uri -> session (on garde le morceau précédent : sa fin arrive après le début du suivant)
let trackSession = null
const finisher = shallowRef(null)

const combo = useCombo({
  onEvent: (e) => {
    if (trackSession) recordEvent(trackSession, e)
    gameRef.value?.record(e)
  },
  scaleKey: computed(() => (pattern.value ? `${overlayType.value}:${root.value}:${pattern.value.id}` : 'none')),
  scaleSize: computed(() => overlay.value.size),
})

watch(
  () => combo.state.value.combo,
  (c) => trackSession && (trackSession.bestCombo = Math.max(trackSession.bestCombo, c)),
)

function onTrackStart(track) {
  trackSession = createTrackSession(track)
  trackSessions[track.uri] = trackSession
  // Morceaux zappés avant la fin : on ne garde que les derniers
  Object.keys(trackSessions).slice(0, -3).forEach((uri) => delete trackSessions[uri])
}

function onTrackEnd(ended) {
  // En mode jeu, c'est le jeu qui affiche la fin de partie
  if (gameOpen.value) {
    delete trackSessions[ended.uri]
    gameRef.value?.trackEnded(ended)
    return
  }
  const session = trackSessions[ended.uri]
  delete trackSessions[ended.uri]
  if (session === trackSession) trackSession = null
  let records = {}
  try {
    records = JSON.parse(localStorage.getItem('fb.trackRecords')) ?? {}
  } catch {
    records = {}
  }
  const result = sessionResult(session, records[ended.uri] ?? 0)
  if (!result) return
  if (result.newRecord) localStorage.setItem('fb.trackRecords', JSON.stringify({ ...records, [ended.uri]: result.score }))
  finisher.value = { ...result, id: Date.now() }
}

// ---------- Mode jeu (plein écran) ----------
const gameOpen = ref(false)
const gameRef = ref(null)
const spotifyRef = ref(null)

function openGame() {
  if (!pattern.value) {
    overlayType.value = 'scale' // le jeu se joue sur une gamme
  }
  finisher.value = null
  gameOpen.value = true
  document.documentElement.requestFullscreen?.().catch(() => {})
}
function closeGame() {
  gameOpen.value = false
  audio.setDuo(false) // retour à une seule guitare
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
}
function onGameStart({ duo = false } = {}) {
  combo.reset()
  history.value = []
  audio.setDuo(duo) // Jam : les entrées 1 et 2 sont suivies séparément
  if (!audio.running.value) audio.start()
}
// Échap en plein écran : le navigateur quitte le plein écran, on quitte aussi le jeu
const onFullscreenChange = () => !document.fullscreenElement && gameOpen.value && closeGame()

// Échap ferme le finisher ou le jeu ; F lance le mode jeu
function onKeydown(e) {
  if (e.key === 'Escape') {
    if (gameOpen.value) closeGame()
    else finisher.value = null
  } else if ((e.key === 'f' || e.key === 'F') && !gameOpen.value && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, select, textarea')) {
    openGame()
  }
}
// La page reste en mémoire quand on passe sur l'Ampli : ses raccourcis ne valent que lorsqu'elle est affichée
function listen(on) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('keydown', onKeydown)
  document[method]('fullscreenchange', onFullscreenChange)
}
// Page affichée : ses boutons vont dans la barre du haut (JOUER, menu des réglages sur mobile)
const active = ref(false)
onActivated(() => {
  reloadSettings()
  listen(true)
  active.value = true
})
onDeactivated(() => {
  listen(false)
  active.value = false
})
onBeforeUnmount(() => {
  listen(false)
  removeEventListener('fb:settings', reloadSettings)
})

// ---------- Notes jouées ----------
const played = shallowRef(null) // { midi, string, fret }
const anchor = ref(null)
const history = ref([])
let historyId = 0
let clearTimer = 0

// ---------- Position sur le manche ----------
// La corde / case de chaque note est choisie sur toute la phrase en cours (doigté le plus jouable,
// voir lib/fingering.js) : les dernières notes peuvent être replacées quand la suite lève le doute.
let phrase = [] // [{ candidates, legato, position, item }] — item : entrée d'historique à corriger
let settled = [] // positions sorties de la phrase (pour situer la main au début de la suivante)
let lastNoteAt = 0

function placeNote(midi, forcedPosition, legato) {
  let candidates = forcedPosition ? [forcedPosition] : findPositions(midi, tuning.value, frets.value)
  // Box choisie : la note est placée dans la box si elle y figure, sinon au plus près
  const box = activeBox.value
  if (box && !forcedPosition) {
    const inBox = candidates.filter((c) => box.keys.has(positionKey(c)))
    const near = candidates.filter((c) => box.ranges.some(([lo, hi]) => c.fret >= lo - 1 && c.fret <= hi + 1))
    candidates = inBox.length ? inBox : near.length ? near : candidates
  }
  if (!candidates.length) return null

  // Un silence termine la phrase ; au-delà de PHRASE_LENGTH notes, les plus anciennes sont figées
  const now = performance.now()
  if (now - lastNoteAt > PHRASE_GAP_MS) settled.push(...phrase.splice(0).map((n) => n.position))
  lastNoteAt = now
  const note = { candidates, legato, position: null, item: null }
  phrase.push(note)
  if (phrase.length > PHRASE_LENGTH) settled.push(...phrase.splice(0, phrase.length - PHRASE_LENGTH).map((n) => n.position))
  settled = settled.slice(-4)

  const path = bestFingering(phrase, handFrom(settled), activeBox.value?.center ?? rootBox(root.value, tuning.value[5]))
  phrase.forEach((n, i) => {
    const moved = n.position && (n.position.string !== path[i].string || n.position.fret !== path[i].fret)
    n.position = path[i]
    // Correction après coup des notes récentes (historique et note affichée)
    if (moved && i >= phrase.length - REVISABLE && n.item) {
      Object.assign(n.item, path[i])
      if (played.value?.id === n.item.id) played.value = { ...played.value, ...path[i] }
    }
  })
  anchor.value = handFrom(phrase.map((n) => n.position))
  return note
}

function registerNote(midi, forcedPosition = null, legato = false, slide = null, { player = null, skipCombo = false, bend = null } = {}) {
  const note = placeNote(midi, forcedPosition, legato)
  if (!note) return
  const position = note.position

  const info = overlay.value.get(pitchClass(midi)) ?? null
  const events = overlay.value.size && !skipCombo ? combo.play({ midi, ...position, info, legato, slide, bend, interval: (pitchClass(midi) - root.value + 12) % 12 }) : []
  const glide = events.some((e) => e.type === 'glide') // note de passage d'un slide : pas une erreur

  history.value.unshift({
    id: ++historyId,
    midi,
    ...position,
    info,
    glide,
    outside: overlay.value.size > 0 && !info && !glide,
  })
  note.item = history.value[0]
  played.value = { id: historyId, midi, ...position, glide, player }
  if (history.value.length > 24) history.value.length = 24
}

// Grand slide : traînée sur le manche, de la case de départ à la case d'arrivée
const slideTrail = shallowRef(null) // { id, string, fromFret, toFret }
let slideId = 0

/** Un slide reste sur la même corde : la note d'arrivée est placée en conséquence quand c'est possible. */
function slidePosition(slide) {
  const from = played.value
  if (!from || from.midi !== slide.from) return null
  const fret = from.fret + (slide.to - slide.from)
  return fret >= 0 && fret <= frets.value ? { string: from.string, fret } : null
}

// Changement de guitare : l'écoute repart avec une détection adaptée à la corde la plus grave,
// et la note affichée (sa corde n'existe peut-être plus) est oubliée
watch(tuningId, () => {
  played.value = null
  phrase = []
  settled = []
  if (audio.running.value) audio.start()
})

const audio = useAudioInput({
  lowestMidi: () => Math.min(...tuning.value),
  onNote: (n) => {
    // Correction d'octave de la note qui vient d'être annoncée : même nom de note, déjà comptée (combo, jeu)
    if (n.octaveFix) return
    // Jam « un seul joueur à la fois » : le joueur qui attend son tour est ignoré (et coupé dans l'ampli)
    if (gameOpen.value && gameRef.value?.isMuted(n.player)) return
    clearTimeout(clearTimer)
    // Un bend se joue sur la même case : la note atteinte reste affichée là où on a attaqué
    const forced = n.slide ? slidePosition(n.slide) : n.bend && played.value ? { string: played.value.string, fret: played.value.fret } : null
    const fromFret = played.value?.fret
    // Jam à deux guitares : la note va au jeu (avec son joueur), pas au combo solo
    const jam = gameOpen.value && gameRef.value?.jamActive
    registerNote(n.midi, forced, n.legato, n.slide, { player: n.player ?? null, skipCombo: jam, bend: n.bend })
    // Le jeu à deux tient un combo par joueur : il reçoit la note complète (legato, slide, bend, position)
    if (jam && n.player !== undefined) gameRef.value.jamNote({ ...n, string: played.value?.string, fret: played.value?.fret })
    if (n.slide && played.value) {
      const to = played.value
      slideTrail.value = { id: ++slideId, string: to.string, fromFret: forced ? fromFret : Math.min(frets.value, Math.max(0, to.fret - (n.slide.to - n.slide.from))), toFret: to.fret }
    }
  },
})

// Garde la dernière note affichée un court instant après la fin du son
watch(audio.current, (c) => {
  if (!c && played.value) {
    clearTimeout(clearTimer)
    clearTimer = setTimeout(() => (played.value = null), 700)
  }
})

// Clic sur le manche : simule une note et indique ta position à l'estimateur
function onFretClick({ string, fret, midi }) {
  clearTimeout(clearTimer)
  registerNote(midi, { string, fret })
  clearTimer = setTimeout(() => {
    if (!audio.current.value) played.value = null
  }, 1200)
}

const alternates = computed(() => {
  if (!played.value || !showAlternates.value) return []
  return findPositions(played.value.midi, tuning.value, frets.value).filter(
    (p) => p.string !== played.value.string || p.fret !== played.value.fret,
  )
})

const playedInfo = computed(() => (played.value ? overlay.value.get(pitchClass(played.value.midi)) : null))
</script>

<template>
  <!-- Fin de backing track : écran « FINISH! » -->
  <div v-if="finisher" class="fixed inset-0 z-50">
    <FinisherFight :key="finisher.id" :result="finisher" @close="finisher = null" />
  </div>

  <!-- Mode jeu plein écran, par-dessus la page (l'écoute et le lecteur Spotify continuent dessous) -->
  <GameMode
    v-if="gameOpen"
    ref="gameRef"
    :scale-title="overlayTitle"
    :scale-key="pattern ? `${overlayType}:${root}:${pattern.id}` : 'none'"
    :overlay="overlay"
    :note-names="NOTE_NAMES[notation]"
    :root="root"
    :scale-id="scaleId"
    :scales="SCALES"
    :state="combo.state.value"
    :floater="combo.floater.value"
    :last-note-at="combo.lastNoteAt.value"
    :decay-ms="combo.decayMs"
    :broke-at="combo.brokeAt.value"
    :played="played"
    :spotify="spotifyRef?.sp ?? null"
    :listening="audio.running.value"
    :levels="audio.levels.value"
    :suggestion="backingSuggestion"
    @update:root="root = $event"
    @update:scale-id="(scaleId = $event), (overlayType = 'scale')"
    @start="onGameStart"
    @close="closeGame"
  >
    <template #board="{ hard }">
      <div class="relative">
        <Fretboard
          :tuning="tuning"
          :frets="frets"
          :overlay="overlay"
          :notation="notation"
          :label-mode="hard ? 'none' : labelMode"
          :body-finish="bodyFinish"
          :match-head="matchHead"
          :played="played"
          :alternates="hard ? [] : alternates"
          :anchor="anchor"
          :focus="activeBox?.keys ?? null"
          :heat="combo.state.value.mult - 1"
          :broke-at="combo.brokeAt.value"
          :slide="slideTrail"
          :played-color="played?.player === 1 ? '#38bdf8' : null"
          bare
          @play="onFretClick"
        />
      </div>
    </template>
    <template #announce>
      <ComboAnnouncement :announcement="combo.announcement.value" />
    </template>
  </GameMode>

  <!-- Animation de chargement : le manche se dessine, puis on plonge dans l'app -->
  <div v-if="splash" class="fixed inset-0 z-50">
    <LoaderNeck @done="splash = false" />
  </div>

  <div class="flex min-h-[calc(100vh-3.5rem)] bg-anthracite text-neutral-200 xl:h-[calc(100vh-3.5rem)] xl:overflow-hidden">
    <!-- ========== Contenu principal ========== -->
    <!-- Dans la barre du haut : écoute de la guitare, réglages, et l'entrée du mode jeu, bien en vue -->
    <Teleport v-if="active" defer to="#topbar-actions">
      <ListenButton :audio="audio" />
      <button class="gear-btn" :class="{ on: settingsOpen }" title="Réglages : entrée audio, guitare, affichage" @click="settingsOpen = !settingsOpen">
        <Icon name="sliders" class="size-5" />
      </button>
      <button class="play-cta" title="Mode jeu plein écran (touche F)" @click="openGame">
        <Icon name="play" class="size-4" />
        JOUER
        <kbd>F</kbd>
      </button>
    </Teleport>

    <SettingsPanel
      v-if="settingsOpen && active"
      v-model:tuning-id="tuningId"
      v-model:notation="notation"
      v-model:label-mode="labelMode"
      v-model:body-finish="bodyFinish"
      v-model:match-head="matchHead"
      v-model:frets="frets"
      v-model:show-alternates="showAlternates"
      :audio="audio"
      @close="settingsOpen = false"
    />

    <main class="mx-auto flex w-full max-w-[1700px] min-w-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8 xl:h-[calc(100vh-3.5rem)]">

      <!-- En-tête : gamme courante + note jouée -->
      <header class="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div class="min-w-0 flex-1 basis-60">
          <!-- Type : gamme, arpège, accord ou manche libre -->
          <div class="flex gap-6 text-sm font-bold tracking-[0.12em] uppercase">
            <button v-for="t in OVERLAY_TYPES" :key="t.id" class="type-tab" :class="{ on: overlayType === t.id }" @click="overlayType = t.id">{{ t.label }}</button>
          </div>
          <!-- Titre = sélecteurs : tonique et gamme se changent en cliquant dessus -->
          <h2 class="mt-3 flex flex-wrap items-baseline gap-x-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
            <template v-if="pattern">
              <Dropdown v-model="root" :options="rootOptions" :columns="6" label="Tonique" button-class="title-pick" />
              <Dropdown v-model="patternModel" :options="patternOptions" :label="isChord ? 'Accord' : overlayType === 'arpeggio' ? 'Arpège' : 'Gamme'" button-class="title-pick" />
            </template>
            <span v-else>Manche libre</span>
          </h2>
          <div v-if="keySyncActive" class="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
            <span class="size-2 rounded-full bg-[#1DB954]" />
            Réglé d'après « <span class="max-w-80 truncate text-neutral-300">{{ keySync.title }}</span> »
          </div>
          <div v-if="pattern" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              v-for="i in pattern.intervals"
              :key="i"
              class="rounded-md px-2 py-0.5 text-xs font-semibold"
              :class="i === 0 ? 'bg-copper-500/20 text-copper-300' : 'bg-neutral-800 text-neutral-300'"
            >
              {{ NOTE_NAMES[notation][(root + i) % 12] }}
              <span class="text-neutral-500">{{ overlay.get((root + i) % 12)?.degree }}</span>
            </span>
            <!-- Position : tout le manche, une box, ou une forme d'accord -->
            <template v-if="boxes.length">
              <span class="mx-2 h-4 w-px bg-white/10" />
              <div class="pos-group">
                <button :class="{ on: !boxIndex }" @click="boxIndex = 0">Tout</button>
                <button v-for="b in boxes" :key="b.index" :class="{ on: boxIndex === b.index + 1 }" :title="`Cases ${boxLabel(b)}`" @click="boxIndex = b.index + 1">
                  {{ isChord ? b.name : b.index + 1 }}
                </button>
              </div>
              <span v-if="activeBox" class="text-xs text-neutral-500 tabular-nums">cases {{ activeBox.ranges[0][0] }}–{{ activeBox.ranges[0][1] }}</span>
            </template>
          </div>
        </div>


        <div class="flex items-center gap-4 rounded-2xl bg-neutral-900 py-3 pr-3 pl-5 ring-1 ring-white/5">
          <div class="text-right">
            <div class="text-[11px] tracking-widest text-neutral-500 uppercase">Note jouée</div>
            <div class="text-sm" :class="!played ? 'text-neutral-600' : playedInfo ? 'text-copper-300' : overlay.size && !played.glide ? 'text-rose-400' : 'text-neutral-400'">
              <template v-if="!played">en attente</template>
              <template v-else-if="playedInfo">degré {{ playedInfo.degree }} · corde {{ played.string + 1 }}, case {{ played.fret }}</template>
              <template v-else-if="played.glide">note de passage · corde {{ played.string + 1 }}, case {{ played.fret }}</template>
              <template v-else-if="overlay.size">hors gamme · corde {{ played.string + 1 }}, case {{ played.fret }}</template>
              <template v-else>corde {{ played.string + 1 }}, case {{ played.fret }}</template>
            </div>
          </div>
          <div
            class="flex h-16 min-w-24 items-center justify-center rounded-xl px-3 text-3xl font-black transition-colors"
            :class="!played ? 'bg-neutral-800 text-neutral-600' : playedInfo || !overlay.size ? 'bg-copper-500 text-white' : played.glide ? 'bg-neutral-700 text-neutral-300' : 'bg-rose-500 text-white'"
          >
            {{ played ? noteName(played.midi, notation, true) : '—' }}
          </div>
        </div>
      </header>

      <!-- Manche -->
      <div class="relative shrink-0">
        <Fretboard
          :tuning="tuning"
          :frets="frets"
          :overlay="boardOverlay"
          :notation="notation"
          :label-mode="labelMode"
          :body-finish="bodyFinish"
          :match-head="matchHead"
          :played="played"
          :alternates="alternates"
          :anchor="anchor"
          :focus="activeBox?.keys ?? null"
          :muted="isChord && activeBox ? activeBox.muted : null"
          :highlight="harmonyChord"
          :slide="slideTrail"
          @play="onFretClick"
        />
      </div>
      <!-- Sous le manche : accords de la gamme (la légende passe alors dans un bouton), sinon la légende -->
      <div v-if="harmony.length" class="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs">
        <span class="font-semibold tracking-widest text-neutral-500 uppercase">Accords de la gamme</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(c, i) in harmony"
            :key="i"
            class="flex items-baseline gap-1.5 rounded-lg px-2.5 py-1 font-bold ring-1 transition"
            :class="harmonyIndex === i ? 'bg-copper-500 text-white ring-copper-400' : 'bg-neutral-900 text-neutral-200 ring-white/10 hover:bg-neutral-800'"
            :title="harmonyIndex === i ? 'Revenir à la gamme' : `Mettre en avant les notes de ${chordLabel(c)}`"
            @click="harmonyIndex = harmonyIndex === i ? null : i"
          >
            <span class="text-sm">{{ chordLabel(c) }}</span>
            <span class="text-[10px] font-semibold opacity-60">{{ c.roman }}</span>
          </button>
        </div>
        <button v-if="harmonyChord && CHORDS.some((x) => x.id === harmonyChord.id)" class="font-semibold text-copper-300 hover:text-copper-200" @click="showChordShapes(harmonyChord)">
          Voir les formes de {{ chordLabel(harmonyChord) }} →
        </button>
        <div class="group relative ml-auto">
          <button class="rounded-lg px-2.5 py-1 font-semibold text-neutral-500 ring-1 ring-white/10 hover:text-neutral-300">Légende</button>
          <div class="pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-64 space-y-2 rounded-xl bg-neutral-900 p-3 text-neutral-400 opacity-0 shadow-xl ring-1 ring-white/10 transition group-focus-within:opacity-100 group-hover:opacity-100">
            <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-copper-400" /> Tonique</span>
            <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-stone-900 ring-1 ring-stone-500" /> Gamme</span>
            <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-stone-50 ring-2 ring-copper-400" /> Note de l'accord choisi</span>
            <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-copper-500" /> Jouée</span>
            <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-rose-500" /> Hors gamme</span>
            <span class="flex items-center gap-1.5"><span class="size-3 rounded-full border-2 border-dashed border-copper-300" /> Même note ailleurs</span>
            <span class="flex items-center gap-1.5"><span class="h-3 w-5 rounded-sm bg-white/15" /> Position de la main</span>
            <p class="text-neutral-600">Clique sur une case pour indiquer où se trouve ta main.</p>
          </div>
        </div>
      </div>
      <div v-else class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1 text-xs text-neutral-500">
        <div class="flex flex-wrap items-center gap-4">
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-copper-400" /> Tonique</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-stone-900 ring-1 ring-stone-500" /> Gamme</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-copper-500" /> Jouée</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-rose-500" /> Hors gamme</span>
          <span class="flex items-center gap-1.5"><span class="size-3 rounded-full border-2 border-dashed border-copper-300" /> Même note ailleurs</span>
          <span class="flex items-center gap-1.5"><span class="h-3 w-5 rounded-sm bg-white/15" /> Position de la main</span>
        </div>
        <span class="text-neutral-600">Clique sur une case pour indiquer où se trouve ta main.</span>
      </div>

      <!-- Backing tracks + accordeur -->
      <div class="mt-4 grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[2fr_1fr] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <SpotifyPlayer ref="spotifyRef" :suggestion="backingSuggestion" @track-change="onTrackChange" @track-start="onTrackStart" @track-end="onTrackEnd" />
        <div class="flex min-h-0 flex-col gap-4">
          <Tuner :midi-float="audio.midiFloat.value" :frequency="audio.frequency.value" :notation="notation" />
          <Metronome class="flex-1" :shortcuts="!gameOpen" />
        </div>
      </div>
    </main>
  </div>
</template>

<!-- Non scopé : title-pick habille aussi le bouton interne de Dropdown (button-class) -->
<style>
@reference "./style.css";

.play-cta {
  @apply relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm sm:gap-2 sm:px-5 font-black tracking-wider text-white italic transition hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0;
  background: linear-gradient(180deg, var(--color-copper-400), var(--color-copper-600));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 3px 0 color-mix(in srgb, var(--color-copper-600) 60%, #000),
    0 8px 28px -4px color-mix(in srgb, var(--color-copper-500) 75%, transparent);
}
/* Halo qui pulse doucement pour attirer l'œil */
.play-cta::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 14px;
  box-shadow: 0 0 0 2px var(--color-copper-400);
  opacity: 0;
  animation: cta-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
.play-cta kbd {
  @apply hidden rounded bg-black/25 px-1.5 text-[10px] font-bold not-italic sm:inline;
}
@keyframes cta-pulse {
  0% {
    opacity: 0.8;
    transform: scale(1);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(1.18, 1.35);
  }
}
@media (prefers-reduced-motion: reduce) {
  .play-cta::after {
    animation: none;
  }
}
/* ---------- Titre cliquable ---------- */
.type-tab {
  @apply relative pb-0.5 text-neutral-500 transition hover:text-neutral-300;
}
.type-tab.on {
  @apply text-copper-300;
}
.type-tab.on::after {
  content: '';
  @apply absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-copper-400;
}
.title-pick {
  @apply -mx-1 rounded-lg px-1 transition hover:bg-white/5;
  text-decoration: underline dotted rgba(255, 255, 255, 0.18);
  text-underline-offset: 6px;
  text-decoration-thickness: 2px;
}
.title-pick:hover,
.title-pick.is-open {
  text-decoration-color: var(--color-copper-400);
}
.pos-group {
  @apply flex overflow-hidden rounded-lg bg-neutral-800/80 p-0.5 text-xs font-bold;
}
.pos-group > button {
  @apply min-w-7 rounded-md px-2 py-1 text-neutral-400 transition hover:text-white;
}
.pos-group > button.on {
  @apply bg-copper-500 text-white;
}
</style>
