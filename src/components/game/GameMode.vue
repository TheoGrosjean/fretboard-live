<script setup>
// Mode jeu plein écran : menu → compte à rebours → partie (HUD) → FINISH! → récapitulatif.
// Le manche est fourni par la page (slot « board ») : l'écoute et le moteur de combo restent ceux du Manche.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { pitchClass } from '../../lib/music'
import { recordEvent } from '../../lib/finisher'
import { checkSilence, createRun, multiplierFor, playNote } from '../../lib/combo'
import {
  CHRONO_DURATIONS,
  COUNTDOWN_STEPS,
  COUNTDOWN_STEP_MS,
  MODES,
  TARGET_MS,
  createGameSession,
  degreeName,
  gameResult,
  getRecord,
  pickTarget,
  recordKey,
  saveRecord,
  targetMultiplier,
  targetPoints,
} from '../../lib/game'
import { PLAYER_COLORS, PLAYER_NAMES, RELAYS, TURN_COUNTS, VARIANTS, createJam, jamNote as playJamNote, jamResult, jamTick, passTurn, turnLeft } from '../../lib/jam'
import { formatScore } from '../finishers/useCountUp'
import ComboAnnouncement from '../ComboAnnouncement.vue'
import FinisherFight from '../finishers/FinisherFight.vue'
import Icon from '../Icon.vue'
import { ampOn } from '../../lib/ampStatus'

const props = defineProps({
  scaleTitle: { type: String, required: true },
  scaleKey: { type: String, required: true },
  overlay: { type: Map, required: true },
  noteNames: { type: Array, required: true }, // 12 noms de notes dans la notation choisie
  root: { type: Number, required: true },
  scaleId: { type: String, required: true },
  scales: { type: Array, required: true },
  state: { type: Object, required: true }, // état du combo (voir useCombo)
  floater: { type: Object, default: null },
  lastNoteAt: { type: Number, default: 0 },
  decayMs: { type: Number, required: true },
  brokeAt: { type: Number, default: 0 },
  played: { type: Object, default: null },
  spotify: { type: Object, default: null }, // contrôles du lecteur Spotify (voir useSpotify), si connecté
  listening: { type: Boolean, default: false },
  levels: { type: Array, default: () => [0, 0] }, // niveaux des entrées 1 et 2 (mode Jam)
})
const emit = defineEmits(['close', 'start', 'update:root', 'update:scaleId'])

// ---------- Réglages ----------
function stored(key, initial) {
  try {
    const v = localStorage.getItem(`fb.game.${key}`)
    return v !== null ? JSON.parse(v) : initial
  } catch {
    return initial
  }
}
const mode = ref(stored('mode', 'libre'))
const duration = ref(stored('duration', 60))
const hard = ref(stored('hard', false)) // noms des notes masqués sur le manche
// Jam ping-pong
const jamVariant = ref(stored('jamVariant', 'duel'))
// Relais mémorisé qui n'existe plus (anciens 4 s / 8 s) : 16 s
const jamRelay = ref(RELAYS.some((r) => r.id === stored('jamRelay', '16')) ? stored('jamRelay', '16') : '16')
const jamTurns = ref(stored('jamTurns', 4))
const SETTINGS = { mode, duration, hard, jamVariant, jamRelay, jamTurns }
watch(Object.values(SETTINGS), () => Object.entries(SETTINGS).forEach(([k, r]) => localStorage.setItem(`fb.game.${k}`, JSON.stringify(r.value))))

const track = computed(() => props.spotify?.track.value ?? null)
const modeAvailable = (id) => id !== 'morceau' || Boolean(track.value)
watch(track, () => !modeAvailable(mode.value) && (mode.value = 'libre'), { immediate: true })
const modeInfo = computed(() => MODES.find((m) => m.id === mode.value))
const recordFor = (id) => getRecord(recordKey(id, duration.value, props.scaleKey))

// ---------- Déroulé ----------
const phase = ref('menu') // 'menu' | 'countdown' | 'playing' | 'finisher' | 'recap'
const step = ref(0)
const session = ref(createGameSession())
const record = ref(0)
const result = ref(null)
const startedAt = ref(0)
const now = ref(performance.now())
let timers = []
const later = (fn, ms) => timers.push(setTimeout(fn, ms))
const clearTimers = () => (timers.forEach(clearTimeout), (timers = []))

const isJam = computed(() => mode.value === 'jam')

function start() {
  if (!modeAvailable(mode.value)) return
  clearTimers()
  emit('start', { duo: isJam.value }) // le mode Jam écoute les deux entrées séparément
  record.value = recordFor(mode.value)
  phase.value = 'countdown'
  step.value = 0
  COUNTDOWN_STEPS.forEach((_, i) => i && later(() => (step.value = i), i * COUNTDOWN_STEP_MS))
  later(begin, COUNTDOWN_STEPS.length * COUNTDOWN_STEP_MS)
}

function begin() {
  emit('start', { duo: isJam.value }) // remet le combo à zéro au moment du GO
  session.value = createGameSession()
  startedAt.value = now.value = performance.now()
  target.value = null
  targetFlash.value = null
  phase.value = 'playing'
  if (mode.value === 'cible') nextTarget()
  if (isJam.value) {
    jam.value = createJam({ variant: jamVariant.value, relay: jamRelay.value, turns: jamTurns.value }, performance.now())
    jamRuns.value = [createRun(), createRun()]
    jamRuns.value[0].lastAt = performance.now()
    announceTurn(0, [])
  }
  if (mode.value === 'morceau' && props.spotify) {
    props.spotify.seek(0)
    if (props.spotify.paused.value) props.spotify.togglePlay()
  }
}

function finish() {
  if (phase.value !== 'playing') return
  if (isJam.value) return finishJam()
  const key = recordKey(mode.value, duration.value, props.scaleKey)
  const subtitle = mode.value === 'morceau' && track.value ? `${track.value.name} · ${props.scaleTitle}` : props.scaleTitle
  const title = mode.value === 'chrono' ? `${modeInfo.value.name} · ${duration.value} s` : modeInfo.value.name
  result.value = { ...gameResult(session.value, { mode: mode.value, title, subtitle, record: record.value }), id: Date.now() }
  saveRecord(key, session.value.score)
  if (mode.value === 'morceau' && props.spotify && !props.spotify.paused.value) props.spotify.togglePlay()
  phase.value = 'finisher'
}

function toMenu() {
  clearTimers()
  phase.value = 'menu'
}

// ---------- Horloge ----------
const elapsed = computed(() => Math.max(0, now.value - startedAt.value))
const remaining = computed(() => Math.max(0, duration.value * 1000 - elapsed.value))
const clock = (ms) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const ticker = setInterval(() => {
  if (phase.value !== 'playing') return
  now.value = performance.now()
  if (mode.value === 'chrono' && remaining.value <= 0) finish()
  if (mode.value === 'cible' && target.value && now.value - target.value.startedAt > TARGET_MS) missTarget()
  if (isJam.value && jam.value) {
    // Silence trop long pendant son propre tour : le combo du joueur se perd
    const turn = jam.value.turn
    handleCombo(checkSilence(jamRuns.value[turn], now.value).filter((e) => e.type === 'break'), turn)
    handleJam(jamTick(jam.value, now.value))
  }
}, 100)

// ---------- Mode Jam ping-pong ----------
const jam = ref(null) // voir lib/jam.js
const jamOutcome = ref(null)
const jamRuns = ref([createRun(), createRun()]) // un combo par joueur, en pause pendant le tour de l'autre
const jamAnnouncement = ref(null)
let jamAnnounceId = 0
let jamAnnounceTimer = 0
const jamLeft = computed(() => (jam.value ? (now.value, turnLeft(jam.value, now.value)) : 0))
const relayName = computed(() => RELAYS.find((r) => r.id === jamRelay.value)?.name)
// Secondes restantes, en relais à temps fixe (en « fin de phrase », la jauge suit le silence)
const jamSecondsLeft = computed(() => {
  const ms = RELAYS.find((r) => r.id === jamRelay.value)?.ms
  return ms && jam.value ? Math.ceil((jamLeft.value * ms) / 1000) : null
})
const BONUS_NAMES = { echo: 'Écho', resolution: 'Résolution', clean: 'Phrase propre' }

function jamAnnounce(text, tone, sub = '', duration = 1600, effect = '') {
  clearTimeout(jamAnnounceTimer)
  jamAnnouncement.value = { id: ++jamAnnounceId, text, tone, sub, effect }
  jamAnnounceTimer = setTimeout(() => (jamAnnouncement.value = null), duration)
}
function announceTurn(player, bonuses) {
  const sub = bonuses.length ? `${PLAYER_NAMES[1 - player]} : ${bonuses.map((b) => `${BONUS_NAMES[b.type]} +${b.points}`).join(' · ')}` : ''
  jamAnnounce(`À TOI, ${PLAYER_NAMES[player].toUpperCase()} !`, player ? 'sky' : 'copper', sub, bonuses.length ? 2200 : 1400)
}
const jamFloaters = ref([[], []]) // points qui s'envolent au-dessus du panneau de chaque joueur
function jamFloat(player, text, kind = 'hit') {
  const f = { id: ++jamAnnounceId, text, kind }
  jamFloaters.value[player] = [...jamFloaters.value[player].slice(-3), f]
  later(() => (jamFloaters.value[player] = jamFloaters.value[player].filter((x) => x !== f)), 900)
}

function handleJam(events) {
  const bonuses = events.filter((e) => BONUS_NAMES[e.type])
  for (const e of events) {
    if (e.type === 'hit') jamVariant.value === 'duel' && jamFloat(e.player, `+${e.points}`)
    else if (e.type === 'relance') jamFloat(e.player, `RELANCE +${e.points}`, 'bonus')
    else if (e.type === 'interrupt') jamAnnounce(`${PLAYER_NAMES[e.player].toUpperCase()}, TU COUPES LA PAROLE !`, 'warn', `${e.points} points`, 1500)
    else if (BONUS_NAMES[e.type]) jamFloat(e.player, `${BONUS_NAMES[e.type].toUpperCase()} +${e.points}`, 'bonus')
    else if (e.type === 'turn') {
      announceTurn(e.player, bonuses)
      if (bonuses.length) burst(16)
      // Le combo du joueur qui reprend la main repart de là où il l'avait laissé
      const run = jamRuns.value[e.player]
      run.lastAt = performance.now()
      run.phraseLength = 0
      run.phraseNotes = 0
    } else if (e.type === 'over') finishJam()
  }
}

const BEND_SIZES = { 1: '½ ton', 2: '1 ton', 3: '1 ton ½' }
/** Événements du combo d'un joueur (voir lib/combo.js) : annonces à sa couleur. */
function handleCombo(events, player) {
  const name = PLAYER_NAMES[player]
  const tone = player ? 'sky' : 'copper'
  for (const e of events) {
    if (e.type === 'tier') jamAnnounce(e.mult === 4 ? '×4 EN FEU !' : `×${e.mult} !`, e.mult === 4 ? 'fire' : tone, name)
    else if (e.type === 'milestone') jamAnnounce(`${e.combo} COMBO !`, tone, name)
    else if (e.type === 'full-scale') jamAnnounce('Gamme complète !', tone, name)
    else if (e.type === 'slide') jamAnnounce('SLIDE', tone, `${e.span} cases · ${name}`, 1500, e.up ? 'slide-up' : 'slide-down')
    else if (e.type === 'bend') jamAnnounce('BEND', tone, `${BEND_SIZES[e.steps] ?? `${e.steps / 2} tons`} · ${name}`, 1500, 'bend')
    else if (e.type === 'repeat') jamAnnounce('Varie les notes !', 'warn', name)
    else if (e.type === 'break') {
      jamAnnounce(e.reason === 'timeout' ? 'Trop lent… combo perdu' : 'Combo perdu', 'danger', name)
      shaking.value = true
      later(() => (shaking.value = false), 450)
    }
  }
}

/**
 * Note jouée sur l'entrée `player` (0 = entrée 1, 1 = entrée 2), transmise par la page :
 * { midi, player, legato, slide, bend, string, fret }.
 */
function jamNote(n) {
  if (phase.value !== 'playing' || !isJam.value || !jam.value) return
  const now = performance.now()
  const pc = pitchClass(n.midi)
  const info = props.overlay.get(pc) ?? null
  let points
  if (n.player === jam.value.turn) {
    // Combo du joueur qui a la main : multiplicateur, slides, bends, annonces
    const note = { midi: n.midi, string: n.string, fret: n.fret, info, legato: n.legato, slide: n.slide, bend: n.bend, interval: (pc - props.root + 12) % 12 }
    const events = playNote(jamRuns.value[n.player], note, props.overlay.size, now)
    handleCombo(events, n.player)
    if (events.some((e) => e.type === 'glide')) return // note de passage (slide, bend) : ni juste ni fausse
    points = events.find((e) => e.type === 'hit')?.points ?? 0
  }
  handleJam(playJamNote(jam.value, n.player, { pc, inScale: Boolean(info), isRoot: Boolean(info?.isRoot) }, now, points))
}
function passJamTurn() {
  if (jam.value) handleJam(passTurn(jam.value, performance.now()))
}
function finishJam() {
  if (phase.value !== 'playing') return
  const outcome = jamResult(jam.value)
  outcome.players.forEach((p, i) => (p.bestCombo = jamRuns.value[i].bestCombo))
  jamOutcome.value = outcome
  jamAnnouncement.value = null
  phase.value = 'jam-over'
}

// ---------- Mode Cible ----------
const target = ref(null) // { pc, degree, startedAt }
const targetFlash = ref(null) // { id, kind: 'hit' | 'miss', text }
let flashId = 0
const targetLeft = computed(() => (target.value ? Math.max(0, 1 - (now.value - target.value.startedAt) / TARGET_MS) : 0))

function nextTarget() {
  target.value = pickTarget(props.overlay, target.value, performance.now())
}
function missTarget() {
  const s = session.value
  s.targets++
  s.streak = 0
  targetFlash.value = { id: ++flashId, kind: 'miss', text: 'Raté !' }
  nextTarget()
}
watch(
  () => props.played?.id,
  () => {
    const p = props.played
    if (phase.value !== 'playing' || mode.value !== 'cible' || !p || !target.value || p.glide) return
    if (pitchClass(p.midi) !== target.value.pc) return
    const s = session.value
    const points = targetPoints(performance.now() - target.value.startedAt, s.streak)
    s.score += points
    s.targets++
    s.targetHits++
    s.streak++
    s.bestStreak = Math.max(s.bestStreak, s.streak)
    targetFlash.value = { id: ++flashId, kind: 'hit', text: `+${points}` }
    burst()
    nextTarget()
  },
)

// ---------- Statistiques (appelé par la page pour chaque événement du combo) ----------
function record_(e) {
  if (phase.value === 'playing') recordEvent(session.value, e)
}
watch(
  () => props.state.combo,
  (c) => phase.value === 'playing' && (session.value.bestCombo = Math.max(session.value.bestCombo, c)),
)
/** Fin d'un morceau Spotify : termine la partie en mode Morceau. */
function trackEnded() {
  if (mode.value === 'morceau') finish()
}
defineExpose({
  record: record_,
  trackEnded,
  jamNote,
  active: computed(() => phase.value !== 'menu'),
  // Partie de Jam en cours (ou sur le point de commencer) : les notes vont au jeu à deux, pas au combo
  jamActive: computed(() => isJam.value && phase.value !== 'menu'),
})

const accuracy = computed(() => {
  const s = session.value
  if (mode.value === 'cible') return s.targets ? Math.round((s.targetHits / s.targets) * 100) : null
  return s.notes ? Math.round((s.hits / s.notes) * 100) : null
})
const shownCombo = computed(() => (mode.value === 'cible' ? session.value.streak : props.state.combo))
const shownMult = computed(() => (mode.value === 'cible' ? targetMultiplier(session.value.streak) : props.state.mult))

// ---------- Effets : particules et secousse ----------
const particles = ref([])
let particleId = 0
function burst(count = 14) {
  const born = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2
    const d = 40 + Math.random() * 70
    return { id: ++particleId, dx: Math.cos(a) * d, dy: Math.sin(a) * d - 20, size: 3 + Math.random() * 5 }
  })
  particles.value = [...particles.value.slice(-40), ...born]
  later(() => (particles.value = particles.value.filter((p) => !born.includes(p))), 800)
}
watch(
  () => props.floater?.id,
  () => phase.value === 'playing' && burst(8 + 2 * props.state.mult),
)

const shaking = ref(false)
watch(
  () => props.brokeAt,
  () => {
    if (phase.value !== 'playing') return
    shaking.value = true
    later(() => (shaking.value = false), 450)
  },
)

// ---------- Clavier ----------
function onKey(e) {
  if (e.target.closest?.('input, select, textarea')) return
  if ((phase.value === 'menu' || phase.value === 'recap' || phase.value === 'jam-over') && e.key === 'Enter') start()
}
addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  clearInterval(ticker)
  clearTimers()
  clearTimeout(jamAnnounceTimer)
  removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="game fixed inset-0 z-40 flex flex-col overflow-hidden text-neutral-100"
    :class="[isJam && jam && phase === 'playing' ? `jam-p${jam.turn + 1}` : `heat-${phase === 'playing' ? shownMult : 1}`, { shaking }]"
  >
    <div class="backdrop" aria-hidden="true" />
    <div v-if="phase === 'playing' && shownMult === 4 && !isJam" class="flames" aria-hidden="true"><span /><span /></div>

    <!-- Quitter, toujours accessible -->
    <button v-if="phase !== 'playing' && phase !== 'countdown'" class="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-neutral-400 ring-1 ring-white/10 backdrop-blur transition hover:bg-white/5 hover:text-white" @click="emit('close')">
      Quitter <kbd class="rounded bg-white/10 px-1.5 text-[10px]">Échap</kbd>
    </button>

    <!-- ========== Menu ========== -->
    <div v-if="phase === 'menu'" class="relative z-10 m-auto max-h-full w-full max-w-4xl overflow-y-auto px-6 py-8">
      <div class="text-center">
        <div class="text-xs font-bold tracking-[0.4em] text-copper-300 uppercase">Fretboard Live</div>
        <h1 class="title mt-1 text-6xl font-black tracking-tight italic sm:text-7xl">MODE JEU</h1>
      </div>

      <!-- Gamme -->
      <div class="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span class="text-neutral-400">Gamme</span>
        <select class="game-field" :value="root" @change="emit('update:root', Number($event.target.value))">
          <option v-for="(n, i) in noteNames" :key="i" :value="i">{{ n }}</option>
        </select>
        <select class="game-field" :value="scaleId" @change="emit('update:scaleId', $event.target.value)">
          <option v-for="s in scales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <!-- Modes -->
      <div class="mt-6 grid gap-3 sm:grid-cols-2">
        <div
          v-for="m in MODES"
          :key="m.id"
          class="mode-card cursor-pointer text-left"
          :class="{ selected: mode === m.id, disabled: !modeAvailable(m.id), 'sm:col-span-2': m.id === 'jam' }"
          role="button"
          :tabindex="modeAvailable(m.id) ? 0 : -1"
          :aria-disabled="!modeAvailable(m.id)"
          :aria-pressed="mode === m.id"
          @click="modeAvailable(m.id) && (mode = m.id)"
          @dblclick="start"
          @keydown.space.prevent="modeAvailable(m.id) && (mode = m.id)"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-xl font-black tracking-tight italic">{{ m.name }}</span>
            <span v-if="recordFor(m.id)" class="text-[11px] font-semibold text-copper-300 tabular-nums">record {{ formatScore(recordFor(m.id)) }}</span>
          </div>
          <p class="mt-1 text-sm text-neutral-400">{{ m.desc }}</p>
          <p v-if="m.id === 'morceau'" class="mt-2 truncate text-xs" :class="track ? 'text-[#1DB954]' : 'text-neutral-500'">
            {{ track ? `♪ ${track.name} · ${track.artists}` : 'Lance d’abord un morceau dans le lecteur Spotify du Manche.' }}
          </p>
          <div v-if="m.id === 'chrono'" class="mt-3 flex gap-2" @click.stop>
            <button v-for="d in CHRONO_DURATIONS" :key="d" class="chip" :class="{ on: duration === d }" @click="(duration = d), (mode = 'chrono')">{{ d < 60 ? `${d} s` : `${d / 60} min` }}</button>
          </div>
          <!-- Réglages de la jam -->
          <div v-if="m.id === 'jam'" class="mt-3" @click.stop="mode = 'jam'">
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
              <button v-for="v in VARIANTS" :key="v.id" class="chip" :class="{ on: jamVariant === v.id }" @click="jamVariant = v.id">{{ v.name }}</button>
              <span class="ml-3">Relais</span>
              <button v-for="r in RELAYS" :key="r.id" class="chip" :class="{ on: jamRelay === r.id }" @click="jamRelay = r.id">{{ r.name }}</button>
              <template v-if="jamVariant === 'duel'">
                <span class="ml-3">Tours</span>
                <button v-for="t in TURN_COUNTS" :key="t" class="chip" :class="{ on: jamTurns === t }" @click="jamTurns = t">{{ t }} chacun</button>
              </template>
            </div>
            <p class="mt-2 text-[11px] text-neutral-500">Guitares sur les entrées 1 et 2 de la Scarlett, en position « Inst ».</p>
          </div>
        </div>
      </div>

      <!-- Options + JOUER -->
      <div class="mt-6 flex flex-col items-center gap-4">
        <label class="flex cursor-pointer items-center gap-3 text-sm text-neutral-300 select-none">
          <input v-model="hard" type="checkbox" class="peer sr-only" />
          <span class="switch" />
          Difficile : noms des notes masqués sur le manche
        </label>
        <button class="play-btn" @click="start">JOUER</button>
        <p v-if="!listening" class="text-xs text-neutral-500">L'écoute de la guitare démarre avec la partie.</p>
        <p v-else class="text-xs text-neutral-500"><kbd class="rounded bg-white/10 px-1.5">Entrée</kbd> pour lancer</p>
      </div>
    </div>

    <!-- ========== Partie (et compte à rebours par-dessus) ========== -->
    <template v-else-if="phase === 'countdown' || phase === 'playing'">
      <!-- HUD du haut : Jam à deux -->
      <header v-if="isJam && jam" class="relative z-10 grid grid-cols-[1fr_auto_1fr] items-start gap-6 px-8 pt-6">
        <div v-for="i in [0, 1]" :key="i" class="player-card" :class="[{ active: jam.turn === i && phase === 'playing' }, i ? 'order-3 text-right' : 'order-1']" :style="{ '--pc': PLAYER_COLORS[i] }">
          <div class="flex items-center gap-2" :class="{ 'flex-row-reverse': i }">
            <span class="size-2.5 rounded-full" :style="{ background: PLAYER_COLORS[i] }" />
            <span class="text-sm font-black tracking-[0.2em] uppercase">{{ PLAYER_NAMES[i] }}</span>
            <span class="text-[10px] text-neutral-500">entrée {{ i + 1 }}</span>
          </div>
          <div class="mt-1 flex items-end gap-3" :class="{ 'flex-row-reverse': i }">
            <div class="text-6xl leading-none font-black tabular-nums">{{ jamVariant === 'duel' ? formatScore(jam.players[i].score) : jam.players[i].notes }}</div>
            <!-- Combo du joueur, gardé d'un tour à l'autre -->
            <div class="mb-1 flex items-center gap-1.5" :class="{ 'flex-row-reverse': i }">
              <span :key="jamRuns[i].combo" class="combo-num text-2xl font-black tabular-nums" :class="jamRuns[i].combo ? 'text-white' : 'text-neutral-600'">{{ jamRuns[i].combo }}</span>
              <span class="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">combo</span>
              <span class="mult rounded-lg px-2 py-0.5 text-sm font-black italic" :class="`mult-${multiplierFor(jamRuns[i].combo)}`">×{{ multiplierFor(jamRuns[i].combo) }}</span>
            </div>
          </div>
          <div class="text-[11px] text-neutral-400">
            {{ jamVariant === 'duel' ? `${jam.players[i].notes} notes` : 'notes' }} · {{ jam.players[i].echoes }} écho{{ jam.players[i].echoes > 1 ? 's' : '' }} · {{ jam.players[i].resolutions }} résolution{{ jam.players[i].resolutions > 1 ? 's' : '' }}
          </div>
          <!-- Niveau de l'entrée : vérifie que chaque guitare arrive bien sur la sienne -->
          <div class="mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/10" :class="{ 'ml-auto': i }">
            <div class="h-full rounded-full transition-[width] duration-75" :style="{ width: levels[i] * 100 + '%', background: PLAYER_COLORS[i] }" />
          </div>
          <span v-for="f in jamFloaters[i]" :key="f.id" class="jam-floater" :class="[f.kind, i ? 'right-44' : 'left-44']">{{ f.text }}</span>
        </div>

        <!-- Balle de ping-pong : de quel côté est la parole -->
        <div class="order-2 flex w-80 flex-col items-center pt-2 text-center">
          <div class="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">
            {{ jamVariant === 'duel' ? `Échange ${Math.min(jam.turnIndex + 1, jam.turnsPerPlayer * 2)} / ${jam.turnsPerPlayer * 2}` : `Échange ${jam.turnIndex + 1}` }}
          </div>
          <!-- La piste de la balle est aussi la jauge du tour : elle se vide depuis le camp de celui qui joue -->
          <div class="court mt-3" :class="{ urgent: jamLeft < 0.25 && phase === 'playing' }" :style="{ '--pc': PLAYER_COLORS[jam.turn] }">
            <span class="fill" :style="{ width: jamLeft * 100 + '%', [jam.turn ? 'right' : 'left']: 0 }" />
            <span class="net" />
            <span class="ball" :style="{ left: jam.turn ? 'calc(100% - 30px)' : '0px' }" />
          </div>
          <div class="mt-3 flex items-baseline gap-3">
            <span class="text-2xl font-black tracking-wide italic" :style="{ color: PLAYER_COLORS[jam.turn] }">À {{ PLAYER_NAMES[jam.turn].toUpperCase() }}</span>
            <span v-if="jamSecondsLeft !== null" class="text-2xl font-black text-white tabular-nums">{{ jamSecondsLeft }} s</span>
          </div>
          <div class="mt-1 text-[10px] text-neutral-500">relais : {{ relayName }}</div>
        </div>
      </header>

      <!-- HUD du haut -->
      <header v-else class="relative z-10 grid grid-cols-[1fr_auto_1fr] items-start gap-6 px-8 pt-6">
        <!-- Combo -->
        <div class="flex items-end gap-4">
          <div class="leading-none">
            <div class="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">{{ mode === 'cible' ? 'Série' : 'Combo' }}</div>
            <div :key="shownCombo" class="combo-num text-7xl font-black tabular-nums" :class="shownCombo ? 'text-white' : 'text-neutral-700'">{{ shownCombo }}</div>
          </div>
          <div class="mult mb-2 rounded-xl px-3 py-1 text-3xl font-black italic" :class="`mult-${shownMult}`">×{{ shownMult }}</div>
        </div>

        <!-- Score -->
        <div class="relative text-center">
          <div class="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">Score</div>
          <div class="score text-6xl font-black tabular-nums sm:text-7xl">{{ formatScore(session.score) }}</div>
          <div class="mt-1 text-xs font-semibold tabular-nums" :class="session.score > record && record ? 'text-copper-300' : 'text-neutral-500'">
            {{ session.score > record && record ? 'NOUVEAU RECORD !' : `record ${record ? formatScore(record) : '—'}` }}
          </div>
          <span v-if="floater && mode !== 'cible'" :key="floater.id" class="floater">{{ floater.text }}</span>
          <span v-for="p in particles" :key="p.id" class="particle" :style="{ '--dx': p.dx + 'px', '--dy': p.dy + 'px', '--s': p.size + 'px' }" />
        </div>

        <!-- Temps / morceau -->
        <div class="text-right">
          <template v-if="mode === 'chrono'">
            <div class="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">Temps</div>
            <div class="text-5xl font-black tabular-nums" :class="remaining <= 10000 && phase === 'playing' ? 'text-rose-400 pulse' : 'text-white'">{{ clock(phase === 'playing' ? remaining : duration * 1000) }}</div>
          </template>
          <template v-else-if="mode === 'morceau' && track">
            <div class="truncate text-sm font-bold text-white">{{ track.name }}</div>
            <div class="truncate text-xs text-neutral-400">{{ track.artists }}</div>
            <div class="mt-2 ml-auto h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-[#1DB954]" :style="{ width: (spotify.duration.value ? (spotify.position.value / spotify.duration.value) * 100 : 0) + '%' }" />
            </div>
          </template>
          <template v-else-if="mode === 'cible'">
            <div class="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">Cibles</div>
            <div class="text-5xl font-black text-white tabular-nums">{{ session.targetHits }}<span class="text-2xl text-neutral-500">/{{ session.targets }}</span></div>
          </template>
          <template v-else>
            <div class="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">Temps</div>
            <div class="text-5xl font-black text-white tabular-nums">{{ clock(elapsed) }}</div>
          </template>
        </div>
      </header>

      <!-- Cible à trouver -->
      <div v-if="mode === 'cible'" class="relative z-10 mt-4 flex flex-col items-center">
        <template v-if="target && phase === 'playing'">
          <div :key="target.startedAt" class="target-in text-center">
            <div class="text-xs font-bold tracking-[0.35em] text-neutral-400 uppercase">Joue la</div>
            <div class="text-5xl font-black tracking-tight text-copper-300 italic">{{ degreeName(target.degree) }}</div>
            <div v-if="!hard" class="mt-1 text-lg font-bold text-neutral-300">{{ noteNames[target.pc] }}</div>
          </div>
          <div class="mt-3 h-1.5 w-72 overflow-hidden rounded-full bg-white/10">
            <div class="h-full rounded-full bg-copper-400 transition-[width] duration-100 ease-linear" :style="{ width: targetLeft * 100 + '%' }" />
          </div>
        </template>
        <span v-if="targetFlash" :key="targetFlash.id" class="target-flash" :class="targetFlash.kind">{{ targetFlash.text }}</span>
      </div>

      <!-- Manche sur scène : faisceau de lumière, légère perspective, lueur et reflet au sol -->
      <main class="stage relative z-10 flex min-h-0 flex-1 flex-col items-center">
        <div class="beam" aria-hidden="true" />
        <div class="neck-glow" aria-hidden="true" />
        <!-- Annonces du combo au-dessus du manche (et non par-dessus), à plat -->
        <div class="relative min-h-28 w-full flex-1">
          <ComboAnnouncement v-if="isJam" :announcement="jamAnnouncement" />
          <slot v-else name="announce" />
        </div>
        <div class="board-wrap" :class="{ enter: phase === 'playing' }">
          <slot name="board" :hard="hard" />
        </div>
        <div class="min-h-6 flex-1" />
      </main>

      <!-- Bas : jauge de temps du combo + infos -->
      <footer class="relative z-10 px-8 pb-6">
        <!-- Jam : jauge du tour, épaisse, à la couleur du joueur qui a la main -->
        <div v-if="isJam && jam" class="turn-gauge" :class="{ urgent: jamLeft < 0.25 && phase === 'playing' }" :style="{ '--pc': PLAYER_COLORS[jam.turn] }">
          <div class="h-full rounded-full transition-[width] duration-100 ease-linear" :style="{ width: (phase === 'playing' ? jamLeft : 1) * 100 + '%', [jam.turn ? 'marginLeft' : 'marginRight']: 'auto' }" />
        </div>
        <div v-if="!isJam" class="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div v-if="state.combo && phase === 'playing'" :key="lastNoteAt" class="drain h-full" :class="`drain-${shownMult}`" :style="{ animationDuration: decayMs + 'ms' }" />
        </div>
        <div class="mt-2 flex justify-between text-xs text-neutral-500">
          <span class="flex items-center gap-3">
            {{ scaleTitle }} · {{ modeInfo.name }}<template v-if="hard"> · difficile</template>
            <span v-if="ampOn" class="flex items-center gap-1.5 font-semibold text-copper-300"><span class="size-1.5 rounded-full bg-copper-400 shadow-[0_0_6px] shadow-copper-400" /> Ampli allumé</span>
          </span>
          <span class="flex items-center gap-4">
            <span v-if="accuracy !== null && !isJam">précision {{ accuracy }} %</span>
            <button v-if="isJam && phase === 'playing'" class="font-semibold text-neutral-300 hover:text-white" @click="passJamTurn">Passer la main</button>
            <button v-if="phase === 'playing'" class="font-semibold text-neutral-300 hover:text-white" @click="finish">Terminer la partie</button>
            <button class="flex items-center gap-1.5 hover:text-white" @click="emit('close')">Quitter <kbd class="rounded bg-white/10 px-1.5 text-[10px]">Échap</kbd></button>
          </span>
        </div>
      </footer>

      <!-- Compte à rebours -->
      <div v-if="phase === 'countdown'" class="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm">
        <div :key="step" class="countdown" :class="{ go: step === COUNTDOWN_STEPS.length - 1 }">{{ COUNTDOWN_STEPS[step] }}</div>
      </div>
    </template>

    <!-- ========== Bilan de la jam ========== -->
    <div v-else-if="phase === 'jam-over'" class="relative z-10 m-auto w-full max-w-3xl px-6 text-center">
      <div class="text-xs font-bold tracking-[0.4em] text-neutral-400 uppercase">Jam ping-pong · {{ jamOutcome.variant === 'duel' ? 'Duel' : 'Jam libre' }}</div>
      <div class="mt-1 text-sm text-neutral-500">{{ scaleTitle }} · {{ jamOutcome.turns }} échanges</div>
      <div class="winner mt-6" :style="{ color: jamOutcome.winner === null ? '#fff' : PLAYER_COLORS[jamOutcome.winner] }">
        {{ jamOutcome.variant !== 'duel' ? 'BELLE JAM !' : jamOutcome.winner === null ? 'ÉGALITÉ !' : `VICTOIRE ${PLAYER_NAMES[jamOutcome.winner].toUpperCase()} !` }}
      </div>
      <div class="mt-8 grid grid-cols-2 gap-4">
        <div v-for="(p, i) in jamOutcome.players" :key="i" class="stat-box !p-5 text-left" :style="{ boxShadow: `inset 0 0 0 ${jamOutcome.winner === i ? 2 : 1}px ${jamOutcome.winner === i ? PLAYER_COLORS[i] : 'rgba(255,255,255,.08)'}` }">
          <div class="flex items-center gap-2 text-sm font-black tracking-[0.2em] uppercase" :style="{ color: PLAYER_COLORS[i] }">{{ p.name }}</div>
          <div v-if="jamOutcome.variant === 'duel'" class="mt-1 text-5xl font-black tabular-nums">{{ formatScore(p.score) }}</div>
          <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-300">
            <span>meilleur combo {{ p.bestCombo }}</span>
            <span>{{ p.notes }} notes</span>
            <span>{{ p.accuracy }} % justes</span>
            <span>{{ p.echoes }} écho{{ p.echoes > 1 ? 's' : '' }}</span>
            <span>{{ p.resolutions }} résolution{{ p.resolutions > 1 ? 's' : '' }}</span>
            <span>{{ p.relances }} relance{{ p.relances > 1 ? 's' : '' }}</span>
            <span v-if="jamOutcome.variant === 'duel'">{{ p.interruptions }} coupure{{ p.interruptions > 1 ? 's' : '' }}</span>
          </div>
        </div>
      </div>
      <div class="mt-10 flex flex-wrap justify-center gap-3">
        <button class="play-btn small" @click="start">Rejouer</button>
        <button class="ghost-btn" @click="toMenu">Changer de mode</button>
        <button class="ghost-btn" @click="emit('close')">Quitter</button>
      </div>
    </div>

    <!-- ========== FINISH! ========== -->
    <div v-else-if="phase === 'finisher'" class="absolute inset-0 z-30">
      <FinisherFight :key="result.id" :result="result" @close="phase = 'recap'" />
    </div>

    <!-- ========== Récapitulatif ========== -->
    <div v-else-if="phase === 'recap'" class="relative z-10 m-auto w-full max-w-2xl px-6 text-center">
      <div class="text-xs font-bold tracking-[0.4em] text-neutral-400 uppercase">{{ result.title }}</div>
      <div class="mt-1 text-sm text-neutral-500">{{ result.artist }}</div>
      <div class="rank mt-6" :class="`rank-${result.rank}`">{{ result.rank }}</div>
      <div class="mt-2 text-6xl font-black tabular-nums">{{ formatScore(result.score) }}</div>
      <div v-if="result.newRecord" class="new-record mt-2">NOUVEAU RECORD !</div>
      <div class="mt-8 grid grid-cols-3 gap-3">
        <div class="stat-box">
          <b>{{ result.bestCombo }}</b>
          <i>{{ mode === 'cible' ? 'meilleure série' : 'meilleur combo' }}</i>
        </div>
        <div class="stat-box">
          <b>{{ result.accuracy }} %</b>
          <i>précision</i>
        </div>
        <div class="stat-box">
          <b>{{ result.count }}</b>
          <i>{{ mode === 'cible' ? 'cibles trouvées' : 'notes jouées' }}</i>
        </div>
      </div>
      <div class="mt-10 flex flex-wrap justify-center gap-3">
        <button class="play-btn small" @click="start">Rejouer</button>
        <button class="ghost-btn" @click="toMenu">Changer de mode</button>
        <button class="ghost-btn" @click="emit('close')">Quitter</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game {
  background: #0b0a09;
}
/* Fond qui chauffe avec le multiplicateur */
.backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 50% 55%, var(--glow), transparent 70%),
    radial-gradient(ellipse 120% 80% at 50% 120%, var(--floor), transparent 60%),
    radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.7));
  transition: background 0.6s;
}
.heat-1 {
  --glow: color-mix(in srgb, #3b82f6 7%, transparent);
  --floor: color-mix(in srgb, var(--color-copper-500) 6%, transparent);
}
.heat-2 {
  --glow: color-mix(in srgb, var(--color-copper-500) 14%, transparent);
  --floor: color-mix(in srgb, var(--color-copper-500) 16%, transparent);
}
.heat-3 {
  --glow: color-mix(in srgb, #f97316 20%, transparent);
  --floor: color-mix(in srgb, #ef4444 22%, transparent);
}
.heat-4 {
  --glow: color-mix(in srgb, #f97316 26%, transparent);
  --floor: color-mix(in srgb, #ef4444 38%, transparent);
}

/* Flammes sur les bords à ×4 */
.flames span {
  position: absolute;
  bottom: -10%;
  width: 34%;
  height: 70%;
  background: radial-gradient(ellipse 60% 80% at 50% 100%, rgba(255, 140, 40, 0.55), rgba(239, 68, 68, 0.25) 45%, transparent 70%);
  filter: blur(18px);
  animation: flicker 0.9s ease-in-out infinite alternate;
  pointer-events: none;
}
.flames span:first-child {
  left: -8%;
}
.flames span:last-child {
  right: -8%;
  animation-delay: -0.45s;
}
@keyframes flicker {
  from {
    transform: scaleY(0.9) translateY(4%);
    opacity: 0.75;
  }
  to {
    transform: scaleY(1.08) translateY(0);
    opacity: 1;
  }
}

.shaking > :not(.backdrop) {
  animation: shake 0.45s;
}
@keyframes shake {
  10%,
  90% {
    transform: translateX(-2px);
  }
  20%,
  80% {
    transform: translateX(4px);
  }
  30%,
  50%,
  70% {
    transform: translateX(-8px);
  }
  40%,
  60% {
    transform: translateX(8px);
  }
}

/* ---------- Menu ---------- */
.title {
  background: linear-gradient(180deg, #fff 30%, var(--color-copper-300));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 6px 24px color-mix(in srgb, var(--color-copper-500) 45%, transparent));
}
.game-field {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  padding: 6px 12px;
  font-weight: 600;
  outline: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.game-field option {
  background: #1c1917;
}
.mode-card {
  border-radius: 16px;
  padding: 18px 20px;
  background: rgba(255, 255, 255, 0.035);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition:
    background 0.15s,
    box-shadow 0.15s,
    transform 0.15s;
}
.mode-card:hover:not(.disabled) {
  background: rgba(255, 255, 255, 0.06);
  transform: translateY(-2px);
}
.mode-card.selected {
  background: color-mix(in srgb, var(--color-copper-500) 14%, transparent);
  box-shadow:
    inset 0 0 0 2px var(--color-copper-400),
    0 10px 40px -10px color-mix(in srgb, var(--color-copper-500) 50%, transparent);
}
.mode-card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.chip {
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #a8a29e;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.chip.on {
  background: var(--color-copper-400);
  color: #1c1917;
  box-shadow: none;
}
.switch {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.15s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  transition: transform 0.15s;
}
.peer:checked + .switch {
  background: var(--color-copper-500);
}
.peer:checked + .switch::after {
  transform: translateX(16px);
}
.peer:focus-visible + .switch {
  outline: 2px solid var(--color-copper-300);
}
.play-btn {
  border-radius: 16px;
  padding: 14px 64px;
  font-size: 26px;
  font-weight: 900;
  font-style: italic;
  letter-spacing: 0.06em;
  color: #fff;
  background: linear-gradient(180deg, var(--color-copper-400), var(--color-copper-600));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 6px 0 color-mix(in srgb, var(--color-copper-600) 60%, #000),
    0 14px 40px -6px color-mix(in srgb, var(--color-copper-500) 70%, transparent);
  transition: transform 0.1s;
}
.play-btn:hover {
  transform: translateY(-2px);
}
.play-btn:active {
  transform: translateY(3px);
}
.play-btn.small {
  padding: 10px 36px;
  font-size: 18px;
}
.ghost-btn {
  border-radius: 14px;
  padding: 10px 24px;
  font-weight: 700;
  color: #d6d3d1;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.ghost-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

/* ---------- HUD ---------- */
.combo-num {
  animation: bump 0.25s ease-out;
}
@keyframes bump {
  from {
    transform: scale(1.18);
  }
}
.mult {
  background: rgba(255, 255, 255, 0.08);
}
.mult-2 {
  background: var(--color-copper-500);
}
.mult-3 {
  background: #ea580c;
}
.mult-4 {
  background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
  background-size: 200% 100%;
  animation: fire 1s linear infinite;
  box-shadow: 0 0 30px rgba(239, 68, 68, 0.6);
}
@keyframes fire {
  to {
    background-position: 200% 0;
  }
}
.score {
  text-shadow: 0 4px 30px color-mix(in srgb, var(--color-copper-500) 40%, transparent);
}
.floater {
  position: absolute;
  top: 18px;
  left: calc(50% + 120px);
  font-size: 22px;
  font-weight: 900;
  color: var(--color-copper-300);
  animation: float-up 0.8s ease-out forwards;
  pointer-events: none;
}
@keyframes float-up {
  from {
    opacity: 1;
    transform: translateY(8px) scale(1.2);
  }
  to {
    opacity: 0;
    transform: translateY(-26px);
  }
}
.particle {
  position: absolute;
  top: 55%;
  left: 50%;
  width: var(--s);
  height: var(--s);
  border-radius: 999px;
  background: var(--color-copper-300);
  box-shadow: 0 0 8px var(--color-copper-400);
  animation: particle 0.75s ease-out forwards;
  pointer-events: none;
}
@keyframes particle {
  to {
    transform: translate(var(--dx), var(--dy)) scale(0.2);
    opacity: 0;
  }
}
.pulse {
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}
.drain {
  width: 100%;
  animation: drain linear forwards;
  background: var(--color-copper-400);
}
.drain-3 {
  background: #f97316;
}
.drain-4 {
  background: linear-gradient(90deg, #f59e0b, #ef4444);
}
@keyframes drain {
  to {
    width: 0;
  }
}
/* ---------- Jam ping-pong ---------- */
.jam-p1 {
  --glow: color-mix(in srgb, var(--color-copper-500) 12%, transparent);
  --floor: color-mix(in srgb, var(--color-copper-500) 14%, transparent);
  --beam: color-mix(in srgb, var(--color-copper-300) 10%, transparent);
  --under: color-mix(in srgb, var(--color-copper-500) 30%, transparent);
}
.jam-p2 {
  --glow: color-mix(in srgb, #38bdf8 12%, transparent);
  --floor: color-mix(in srgb, #38bdf8 14%, transparent);
  --beam: color-mix(in srgb, #7dd3fc 10%, transparent);
  --under: color-mix(in srgb, #0ea5e9 30%, transparent);
}
.player-card {
  position: relative;
  opacity: 0.45;
  transition:
    opacity 0.3s,
    transform 0.3s;
}
.player-card.active {
  opacity: 1;
  transform: scale(1.04);
}
.player-card.active > div:nth-child(2) {
  color: var(--pc);
  text-shadow: 0 4px 30px color-mix(in srgb, var(--pc) 45%, transparent);
}
.court {
  position: relative;
  width: 100%;
  height: 30px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.1),
    0 0 30px -6px color-mix(in srgb, var(--pc) 60%, transparent);
  transition: box-shadow 0.45s;
}
.court .fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--pc) 75%, #fff), var(--pc));
  opacity: 0.55;
  transition:
    width 0.1s linear,
    background 0.45s;
}
.turn-gauge {
  height: 12px;
  display: flex;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}
.turn-gauge > div {
  background: linear-gradient(180deg, color-mix(in srgb, var(--pc) 70%, #fff), var(--pc));
  box-shadow: 0 0 18px 2px color-mix(in srgb, var(--pc) 55%, transparent);
}
/* Fin de tour : la jauge clignote */
.court.urgent .fill,
.turn-gauge.urgent > div {
  animation: pulse 0.5s ease-in-out infinite;
}
.court .net {
  position: absolute;
  left: 50%;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: rgba(255, 255, 255, 0.25);
}
.court .ball {
  position: absolute;
  top: 0;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 30%, #fff, var(--pc) 55%);
  box-shadow: 0 0 18px 3px var(--pc);
  z-index: 1;
  transition:
    left 0.45s cubic-bezier(0.3, 0, 0.2, 1),
    background 0.45s;
}
.jam-floater {
  position: absolute;
  top: 34px;
  font-size: 18px;
  font-weight: 900;
  font-style: italic;
  color: var(--pc);
  animation: float-up 0.9s ease-out forwards;
  pointer-events: none;
  white-space: nowrap;
}
.jam-floater.bonus {
  font-size: 22px;
  color: #fff;
  text-shadow: 0 0 18px var(--pc);
}
.winner {
  font-size: 64px;
  font-weight: 900;
  font-style: italic;
  line-height: 1;
  text-shadow: 0 8px 50px currentColor;
  animation: stamp 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}

/* ---------- Scène du manche ---------- */
.stage {
  perspective: 1400px;
  perspective-origin: 50% 20%;
}
.board-wrap {
  position: relative;
  width: min(1700px, calc(100vw - 120px));
  transform: rotateX(14deg);
  transform-origin: 50% 60%;
  /* reflet sur le sol de la scène */
  -webkit-box-reflect: below 4px linear-gradient(transparent 70%, rgba(255, 255, 255, 0.09));
  filter: drop-shadow(0 30px 40px rgba(0, 0, 0, 0.85));
}
.board-wrap.enter {
  animation: neck-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes neck-in {
  from {
    opacity: 0;
    transform: rotateX(35deg) translateY(60px) scale(0.92);
  }
}
/* Faisceau de lumière qui tombe sur le manche, teinté par le multiplicateur */
.beam {
  position: absolute;
  top: -12%;
  left: 50%;
  width: 70%;
  height: 120%;
  transform: translateX(-50%);
  background: radial-gradient(ellipse 50% 60% at 50% 0%, var(--beam), transparent 70%);
  pointer-events: none;
  transition: background 0.6s;
}
/* Lueur sous le manche */
.neck-glow {
  position: absolute;
  left: 8%;
  right: 8%;
  top: 50%;
  height: 34%;
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--under), transparent);
  filter: blur(30px);
  pointer-events: none;
  transition: background 0.6s;
}
.heat-1 {
  --beam: rgba(255, 255, 255, 0.06);
  --under: color-mix(in srgb, var(--color-copper-500) 18%, transparent);
}
.heat-2 {
  --beam: color-mix(in srgb, var(--color-copper-300) 12%, transparent);
  --under: color-mix(in srgb, var(--color-copper-500) 35%, transparent);
}
.heat-3 {
  --beam: color-mix(in srgb, #fdba74 16%, transparent);
  --under: color-mix(in srgb, #f97316 45%, transparent);
}
.heat-4 {
  --beam: color-mix(in srgb, #fcd34d 20%, transparent);
  --under: color-mix(in srgb, #ef4444 55%, transparent);
}

/* Cible */
.target-in {
  animation: target-in 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
@keyframes target-in {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
}
.target-flash {
  position: absolute;
  top: 10px;
  left: calc(50% + 180px);
  font-size: 28px;
  font-weight: 900;
  font-style: italic;
  animation: float-up 0.9s ease-out forwards;
}
.target-flash.hit {
  color: var(--color-copper-300);
}
.target-flash.miss {
  color: #fb7185;
}

/* Compte à rebours */
.countdown {
  font-size: 180px;
  font-weight: 900;
  font-style: italic;
  line-height: 1;
  color: #fff;
  text-shadow: 0 10px 60px color-mix(in srgb, var(--color-copper-500) 70%, transparent);
  animation: count 0.7s cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
}
.countdown.go {
  color: var(--color-copper-300);
}
@keyframes count {
  from {
    opacity: 0;
    transform: scale(2.2);
  }
  25% {
    opacity: 1;
    transform: scale(1);
  }
  80% {
    opacity: 1;
  }
  to {
    opacity: 0;
    transform: scale(0.85);
  }
}

/* ---------- Récapitulatif ---------- */
.rank {
  display: inline-block;
  font-size: 140px;
  font-weight: 900;
  font-style: italic;
  line-height: 1;
  animation: count 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  animation-name: stamp;
}
@keyframes stamp {
  from {
    opacity: 0;
    transform: scale(2) rotate(-12deg);
  }
}
.rank-S {
  color: #fbbf24;
  text-shadow: 0 0 40px rgba(251, 191, 36, 0.6);
}
.rank-A {
  color: var(--color-copper-300);
}
.rank-B {
  color: #e7e5e4;
}
.rank-C {
  color: #a8a29e;
}
.new-record {
  display: inline-block;
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.2em;
  color: #1c1917;
  background: linear-gradient(90deg, #fbbf24, var(--color-copper-400));
}
.stat-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: 14px;
  padding: 14px 8px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
}
.stat-box b {
  font-size: 24px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.stat-box i {
  font-size: 11px;
  font-style: normal;
  color: #a8a29e;
}
</style>
