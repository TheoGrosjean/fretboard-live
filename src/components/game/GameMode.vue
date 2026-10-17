<script setup>
// Mode jeu plein écran : menu → compte à rebours → partie (HUD) → FINISH! → récapitulatif.
// Le manche est fourni par la page (slot « board ») : l'écoute et le moteur de combo restent ceux du Manche.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { pitchClass } from '../../lib/music'
import { recordEvent } from '../../lib/finisher'
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
import { formatScore } from '../finishers/useCountUp'
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
watch([mode, duration, hard], () => {
  localStorage.setItem('fb.game.mode', JSON.stringify(mode.value))
  localStorage.setItem('fb.game.duration', JSON.stringify(duration.value))
  localStorage.setItem('fb.game.hard', JSON.stringify(hard.value))
})

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

function start() {
  if (!modeAvailable(mode.value)) return
  clearTimers()
  emit('start')
  record.value = recordFor(mode.value)
  phase.value = 'countdown'
  step.value = 0
  COUNTDOWN_STEPS.forEach((_, i) => i && later(() => (step.value = i), i * COUNTDOWN_STEP_MS))
  later(begin, COUNTDOWN_STEPS.length * COUNTDOWN_STEP_MS)
}

function begin() {
  emit('start') // remet le combo à zéro au moment du GO
  session.value = createGameSession()
  startedAt.value = now.value = performance.now()
  target.value = null
  targetFlash.value = null
  phase.value = 'playing'
  if (mode.value === 'cible') nextTarget()
  if (mode.value === 'morceau' && props.spotify) {
    props.spotify.seek(0)
    if (props.spotify.paused.value) props.spotify.togglePlay()
  }
}

function finish() {
  if (phase.value !== 'playing') return
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
}, 100)

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
defineExpose({ record: record_, trackEnded, active: computed(() => phase.value !== 'menu') })

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
  if (phase.value === 'menu' && e.key === 'Enter') start()
  else if (phase.value === 'recap' && e.key === 'Enter') start()
}
addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  clearInterval(ticker)
  clearTimers()
  removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="game fixed inset-0 z-40 flex flex-col overflow-hidden text-neutral-100" :class="[`heat-${phase === 'playing' ? shownMult : 1}`, { shaking }]">
    <div class="backdrop" aria-hidden="true" />
    <div v-if="phase === 'playing' && shownMult === 4" class="flames" aria-hidden="true"><span /><span /></div>

    <!-- Quitter, toujours accessible -->
    <button v-if="phase !== 'playing' && phase !== 'countdown'" class="absolute top-4 right-4 z-20 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-neutral-400 ring-1 ring-white/10 backdrop-blur transition hover:bg-white/5 hover:text-white" @click="emit('close')">
      Quitter <kbd class="rounded bg-white/10 px-1.5 text-[10px]">Échap</kbd>
    </button>

    <!-- ========== Menu ========== -->
    <div v-if="phase === 'menu'" class="relative z-10 m-auto w-full max-w-4xl px-6 py-10">
      <div class="text-center">
        <div class="text-xs font-bold tracking-[0.4em] text-copper-300 uppercase">Fretboard Live</div>
        <h1 class="title mt-1 text-6xl font-black tracking-tight italic sm:text-7xl">MODE JEU</h1>
      </div>

      <!-- Gamme -->
      <div class="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span class="text-neutral-400">Gamme</span>
        <select class="game-field" :value="root" @change="emit('update:root', Number($event.target.value))">
          <option v-for="(n, i) in noteNames" :key="i" :value="i">{{ n }}</option>
        </select>
        <select class="game-field" :value="scaleId" @change="emit('update:scaleId', $event.target.value)">
          <option v-for="s in scales" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <!-- Modes -->
      <div class="mt-8 grid gap-3 sm:grid-cols-2">
        <div
          v-for="m in MODES"
          :key="m.id"
          class="mode-card cursor-pointer text-left"
          :class="{ selected: mode === m.id, disabled: !modeAvailable(m.id) }"
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
        </div>
      </div>

      <!-- Options + JOUER -->
      <div class="mt-8 flex flex-col items-center gap-5">
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
      <!-- HUD du haut -->
      <header class="relative z-10 grid grid-cols-[1fr_auto_1fr] items-start gap-6 px-8 pt-6">
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
          <slot name="announce" />
        </div>
        <div class="board-wrap" :class="{ enter: phase === 'playing' }">
          <slot name="board" :hard="hard" />
        </div>
        <div class="min-h-6 flex-1" />
      </main>

      <!-- Bas : jauge de temps du combo + infos -->
      <footer class="relative z-10 px-8 pb-6">
        <div class="h-2.5 overflow-hidden rounded-full bg-white/10">
          <div v-if="state.combo && phase === 'playing'" :key="lastNoteAt" class="drain h-full" :class="`drain-${shownMult}`" :style="{ animationDuration: decayMs + 'ms' }" />
        </div>
        <div class="mt-2 flex justify-between text-xs text-neutral-500">
          <span class="flex items-center gap-3">
            {{ scaleTitle }} · {{ modeInfo.name }}<template v-if="hard"> · difficile</template>
            <span v-if="ampOn" class="flex items-center gap-1.5 font-semibold text-copper-300"><span class="size-1.5 rounded-full bg-copper-400 shadow-[0_0_6px] shadow-copper-400" /> Ampli allumé</span>
          </span>
          <span class="flex items-center gap-4">
            <span v-if="accuracy !== null">précision {{ accuracy }} %</span>
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
