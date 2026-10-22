<script setup>
// Mode Jouer façon Rocksmith : préparation (piste, vitesse, difficulté), autoroute 3D, Riff Repeater, bilan.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import Icon from '../Icon.vue'
import { Highway } from './highway'
import { parseScore } from '../../lib/songLibrary'
import { LEVELS, STRING_COLORS, buildChart, playableTracks, tuningName } from '../../lib/songChart'
import { createTransport, renderBacking } from '../../lib/playEngine'
import { createPlaySession } from '../../lib/playSession'
import { createDrumKit } from '../../lib/drumSynth'
import { noteName } from '../../lib/music'
import { useAudioInput } from '../../composables/useAudioInput'

const props = defineProps({ song: { type: Object, required: true } })
const emit = defineEmits(['close'])

const DETECT_LATENCY = 0.11 // s : temps moyen pour reconnaître une note après l'attaque
const COUNT_IN_BEATS = 4
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

function stored(key, initial) {
  try {
    const v = localStorage.getItem(`fb.play.${key}`)
    return v !== null ? JSON.parse(v) : initial
  } catch {
    return initial
  }
}
const save = (key, v) => localStorage.setItem(`fb.play.${key}`, JSON.stringify(v))

// ---------- Préparation ----------
const phase = ref('setup') // 'setup' | 'loading' | 'playing' | 'paused' | 'results'
const tracks = shallowRef([])
const trackIndex = ref(null)
const speed = ref(stored('speed', 1))
const dynamic = ref(stored('dynamic', true))
const synthDrums = ref(stored('synthDrums', true))
const offsetMs = ref(stored('offsetMs', 0)) // réglage fin de la synchro détection / jeu
const backingVolume = ref(stored('backingGain', 1.6)) // gain linéaire après mise au niveau : 1 = pic à −0,5 dB, 4 = +12 dB (limité)
const loading = ref(0)
const error = ref('')
let at = null
let score = null

onMounted(async () => {
  try {
    at = await import('@coderline/alphatab')
    score = await parseScore(props.song.data)
    tracks.value = playableTracks(score).map(({ t, index }) => ({ index, name: t.name?.trim() || `Piste ${index + 1}`, strings: t.staves[0].tuning.length, tuning: [...t.staves[0].tuning], notes: props.song.tracks[index]?.notes ?? 0 }))
    const remembered = stored(`track:${props.song.id}`, null)
    trackIndex.value = tracks.value.find((t) => t.index === remembered)?.index ?? [...tracks.value].sort((a, b) => b.notes - a.notes)[0]?.index ?? null
  } catch {
    error.value = 'Ce fichier ne peut pas être joué.'
  }
})
const selectedTrack = computed(() => tracks.value.find((t) => t.index === trackIndex.value))

// ---------- Partie ----------
const canvas = ref(null)
let highway = null
let ctx = null
let transport = null
let fullBuffer = null
let chart = null
let session = null
let mainSession = null
let raf = 0
let beatLen = 0.5

const hud = ref({ score: 0, streak: 0, mult: 1, accuracy: 0, t: 0, section: null, countIn: 0, level: LEVELS })
const popups = ref([])
const banner = ref(null)
const heard = ref(null) // dernière note entendue
let popupId = 0
let lastSection = -1

const audio = useAudioInput({ onNote: onHeard })

function sectionsReal(spd, from = 0) {
  return chart.sections.map((s) => ({ index: s.index, name: s.name, t0: (s.start - from) / spd, t1: (s.end - from) / spd }))
}

async function start() {
  if (trackIndex.value === null) return
  error.value = ''
  phase.value = 'loading'
  loading.value = 0
  save('speed', speed.value)
  save('dynamic', dynamic.value)
  save('synthDrums', synthDrums.value)
  save(`track:${props.song.id}`, trackIndex.value)
  try {
    chart = buildChart(at, score, trackIndex.value)
    const sectionAt = (time) => Math.max(0, chart.sections.findLastIndex((s) => s.start <= time + 1e-6))
    chart.notes.forEach((n) => (n.section = sectionAt(n.time)))
    ctx ??= new AudioContext({ latencyHint: 'interactive' })
    transport ??= createTransport(ctx)
    transport.setVolume(backingVolume.value)
    transport.stop()
    fullBuffer = riffBuffer = null // libère l'accompagnement précédent avant d'en calculer un nouveau
    fullBuffer = await renderBacking(ctx, { data: props.song.data, trackIndex: trackIndex.value, speed: speed.value, synthDrums: synthDrums.value, onProgress: (p) => (loading.value = p) })
    if (!audio.running.value) audio.start() // micro / interface : la partie se joue même sans
    document.documentElement.requestFullscreen?.().catch(() => {})
    phase.value = 'playing'
    await nextTick()
    setupHighway()
    playFull(0)
  } catch (e) {
    error.value = /webgl/i.test(e.message) ? "Ton navigateur n'arrive pas à afficher la 3D (WebGL) : active l'accélération matérielle dans ses réglages." : `Préparation impossible : ${e.message}`
    phase.value = 'setup'
  }
}

function setupHighway() {
  if (highway) return
  highway = new Highway(canvas.value)
  onResize()
  loop()
}

/** Lecture du morceau entier depuis `from` (s réelles), avec décompte. */
function playFull(from) {
  riff.value = null
  const spd = speed.value
  const notes = chart.notes.map((n) => ({ ...n, t: n.time / spd }))
  if (!mainSession || from === 0) mainSession = createPlaySession({ notes, sections: sectionsReal(spd), dynamic: dynamic.value, levels: stored(`levels:${props.song.id}:${trackIndex.value}`, {}) })
  session = mainSession
  highway.setChart(chart, { speed: spd })
  syncHighwayStates()
  highway.setVisibility((n) => session.isVisible(n))
  beatLen = beatLength(spd)
  countIn(beatLen)
  transport.start(fullBuffer, { offset: from, delay: beatLen * COUNT_IN_BEATS })
  lastSection = -1
  phase.value = 'playing'
}
const beatLength = (spd) => (chart.beats.length > 1 ? (chart.beats[1].time - chart.beats[0].time) / spd : 0.5)

/** Clics de décompte, sur le temps du morceau. */
function countIn(len) {
  const kit = createDrumKit(ctx, transport.out)
  for (let i = 0; i < COUNT_IN_BEATS; i++) kit.hit(37, ctx.currentTime + i * len, i === 0 ? 127 : 95) // bord de caisse claire
  setTimeout(() => kit.destroy(), (COUNT_IN_BEATS * len + 1) * 1000)
}
function syncHighwayStates() {
  highway.resetStates()
  for (const [id, kind] of session.state) kind === 'hit' ? highway.state.set(id, { kind: 'hit', at: -99 }) : highway.miss(id)
}

/** Note entendue : on la compare à la partition, au moment où elle a été attaquée. */
function onHeard(n) {
  heard.value = { name: noteName(n.midi, 'fr'), id: ++popupId }
  if (phase.value !== 'playing' || !session) return
  const t = transport.time() - DETECT_LATENCY - offsetMs.value / 1000
  session.played(n.midi, t)
}

function loop() {
  raf = requestAnimationFrame(loop)
  if (!highway || !session) return
  const t = phase.value === 'playing' ? transport.time() : hud.value.t
  if (phase.value === 'playing') {
    session.tick(t - DETECT_LATENCY - offsetMs.value / 1000)
    for (const e of session.events.splice(0)) handleEvent(e)
    if (riff.value) riffTick()
    else if (t > chart.duration / speed.value + 0.6) finish()
  }
  highway.render(t)
  const sec = currentSection(t)
  if (sec !== lastSection && sec >= 0 && t >= 0) {
    lastSection = sec
    if (!riff.value) showBanner(chart.sections[sec].name)
  }
  hud.value = {
    score: session.score,
    streak: session.streak,
    mult: session.multiplier(),
    accuracy: session.accuracy(),
    t,
    section: sec,
    countIn: t < 0 ? Math.ceil(-t / beatLen) : 0,
    level: session.levelOf(sec),
  }
}
function currentSection(t) {
  if (riff.value) return riff.value.section
  const time = t * speed.value
  return chart.sections.findLastIndex((s) => s.start <= time)
}

function handleEvent(e) {
  if (e.type === 'hit') {
    highway.hit(e.id, e.perfect)
    if (!e.silent) popup(e.perfect ? 'Parfait' : e.dt < 0 ? 'En avance' : 'En retard', e.perfect ? 'perfect' : 'good')
  } else if (e.type === 'miss') highway.miss(e.id)
  else if (e.type === 'mult') popup(e.mult === 4 ? '×4 EN FEU !' : `×${e.mult}`, 'mult')
  else if (e.type === 'level') showBanner(e.up ? `Niveau ${e.level} · plus de notes` : `Niveau ${e.level} · on simplifie`, e.section)
}
function popup(text, kind) {
  const p = { id: ++popupId, text, kind }
  popups.value = [...popups.value.slice(-3), p]
  setTimeout(() => (popups.value = popups.value.filter((x) => x !== p)), 900)
}
let bannerTimer = 0
function showBanner(title, sub = '') {
  banner.value = { id: ++popupId, title, sub }
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => (banner.value = null), 2200)
}

// ---------- Pause ----------
function pause() {
  if (phase.value !== 'playing') return
  hud.value = { ...hud.value }
  transport.stop()
  phase.value = 'paused'
}
function resume() {
  if (riff.value) return startRiff(riff.value.section, riff.value.speed)
  const t = Math.max(0, hud.value.t)
  phase.value = 'playing'
  beatLen = beatLength(speed.value)
  countIn(beatLen)
  transport.start(fullBuffer, { offset: t, delay: beatLen * COUNT_IN_BEATS })
}
function restart() {
  mainSession = null
  popups.value = []
  playFull(0)
}

// ---------- Riff Repeater ----------
const riff = ref(null) // { section, speed, pass, auto, rendering }
const riffAuto = ref(stored('riffAuto', true))
const riffSpeed = ref(stored('riffSpeed', 0.7))
let riffBuffer = null
let riffLen = 0
let riffLoops = 0

async function startRiff(index, spd = riffSpeed.value) {
  transport.stop()
  save('riffAuto', riffAuto.value)
  save('riffSpeed', riffSpeed.value)
  const sec = chart.sections[index]
  const next = chart.sections[index + 1]
  riff.value = { section: index, speed: spd, pass: riff.value?.section === index ? riff.value.pass : 1, auto: riffAuto.value, rendering: true }
  phase.value = 'playing'
  try {
    riffBuffer = null
    const endTick = next ? next.startTick : undefined
    riffBuffer = await renderBacking(ctx, { data: props.song.data, trackIndex: trackIndex.value, speed: spd, synthDrums: synthDrums.value, range: { startTick: sec.startTick, endTick: endTick ?? sec.startTick + 1e9 } })
  } catch (e) {
    error.value = e.message
    riff.value = null
    return pause()
  }
  riffLen = (sec.end - sec.start) / spd
  const notes = chart.notes.filter((n) => n.section === index).map((n) => ({ ...n, t: (n.time - sec.start) / spd }))
  const sections = sectionsReal(spd, sec.start).map((s, i) => (i === index ? { ...s, t0: 0, t1: riffLen } : { ...s, t0: Infinity, t1: Infinity }))
  session = createPlaySession({ notes, sections, dynamic: dynamic.value, levels: mainSession.levels })
  highway.setChart({ ...chart, notes: chart.notes.filter((n) => n.section === index), beats: chart.beats.filter((b) => b.time >= sec.start - 1e-6 && b.time < sec.end - 1e-6) }, { speed: spd, offset: sec.start })
  highway.setVisibility((n) => session.isVisible(n))
  riff.value = { ...riff.value, rendering: false }
  beatLen = beatLength(spd)
  countIn(beatLen)
  transport.start(riffBuffer, { loop: true, loopEnd: riffLen, delay: beatLen * COUNT_IN_BEATS })
  riffLoops = 0
}
function riffTick() {
  const loops = transport.loops()
  if (loops <= riffLoops || riff.value.rendering) return
  riffLoops = loops
  // Fin d'un passage : bilan, puis accélération si c'est réussi
  session.tick(riffLen + 1)
  for (const e of session.events.splice(0)) handleEvent(e)
  const st = session.sectionStats[riff.value.section]
  const acc = st.total ? st.hits / st.total : 0
  mainSession.levels = { ...session.levels }
  popup(`Passage ${riff.value.pass} : ${Math.round(acc * 100)} %`, acc >= 0.9 ? 'perfect' : 'good')
  riff.value.pass++
  if (riff.value.auto && acc >= 0.9 && riff.value.speed < 1) {
    const spd = Math.min(1, Math.round((riff.value.speed + 0.1) * 10) / 10)
    showBanner(`Vitesse ${Math.round(spd * 100)} %`, 'Réussi, on accélère')
    startRiff(riff.value.section, spd)
    return
  }
  session.resetSection(riff.value.section)
  highway.resetStates()
}
function leaveRiff() {
  const index = riff.value?.section ?? 0
  riff.value = null
  save(`levels:${props.song.id}:${trackIndex.value}`, mainSession.levels)
  playFull(Math.max(0, chart.sections[index].start / speed.value - 1))
}

// ---------- Fin de partie ----------
const results = ref(null)
function finish() {
  transport.stop()
  const s = session
  const accuracy = s.accuracy()
  const key = `${props.song.id}:${trackIndex.value}`
  const records = stored('records', {})
  const record = records[key] ?? 0
  if (s.score > record) save('records', { ...records, [key]: s.score })
  save(`levels:${props.song.id}:${trackIndex.value}`, s.levels)
  results.value = {
    score: s.score,
    accuracy,
    rank: accuracy >= 0.95 ? 'S' : accuracy >= 0.85 ? 'A' : accuracy >= 0.7 ? 'B' : 'C',
    hits: s.hits,
    total: s.hits + s.misses,
    perfects: s.perfects,
    bestStreak: s.bestStreak,
    record,
    newRecord: s.score > record,
    sections: chart.sections.map((sec, i) => ({ name: sec.name, ...s.sectionStats[i] })),
  }
  phase.value = 'results'
  countUp()
}
const shownScore = ref(0)
function countUp() {
  const target = results.value.score
  const t0 = performance.now()
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 1400)
    shownScore.value = Math.round(target * (1 - (1 - k) ** 3))
    if (k < 1) requestAnimationFrame(step)
  }
  step()
}
const worstSection = computed(() => {
  const list = results.value?.sections.map((s, i) => ({ ...s, i, acc: s.total ? s.hits / s.total : 1 })).filter((s) => s.total) ?? []
  return list.sort((a, b) => a.acc - b.acc)[0] ?? null
})

// ---------- Fenêtre, clavier, sortie ----------
function onResize() {
  if (!highway || !canvas.value) return
  const r = canvas.value.parentElement.getBoundingClientRect()
  highway.resize(r.width, r.height)
}
function onKey(e) {
  if (e.key === 'Escape' || e.key === ' ') {
    e.preventDefault()
    if (phase.value === 'playing') pause()
    else if (phase.value === 'paused' && e.key === ' ') resume()
  } else if ((e.key === 'r' || e.key === 'R') && (phase.value === 'paused' || phase.value === 'results')) restart()
}
const onFullscreen = () => !document.fullscreenElement && phase.value === 'playing' && pause()
addEventListener('resize', onResize)
addEventListener('keydown', onKey)
document.addEventListener('fullscreenchange', onFullscreen)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  removeEventListener('resize', onResize)
  removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreen)
  transport?.stop()
  highway?.dispose()
  ctx?.close()
  audio.stop()
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
})
function quit() {
  emit('close')
}

const clock = (s) => {
  const v = Math.max(0, Math.floor(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}
/** Position dans le morceau (s, vitesse normale), y compris en boucle Riff Repeater. */
const songPos = computed(() => (riff.value && chart ? chart.sections[riff.value.section].start + Math.max(0, hud.value.t) * riff.value.speed : hud.value.t * speed.value))
const progress = computed(() => (chart && phase.value !== 'setup' ? Math.min(1, Math.max(0, songPos.value / chart.duration)) : 0))
const sectionBars = computed(() => {
  void hud.value.t // recalcul à chaque image (chart et la session ne sont pas réactifs)
  if (!chart || !session) return []
  return chart.sections.map((s, i) => {
    const st = mainSession?.sectionStats[i]
    return { name: s.name, width: ((s.end - s.start) / chart.duration) * 100, acc: st?.total ? st.hits / st.total : null, current: i === hud.value.section }
  })
})
const accColor = (acc) => (acc === null ? 'rgba(255,255,255,0.18)' : acc >= 0.9 ? 'var(--color-copper-400)' : acc >= 0.6 ? '#fbbf24' : '#f43f5e')
</script>

<template>
  <div class="play fixed inset-0 z-50 overflow-hidden text-neutral-100">
    <!-- ========== Préparation ========== -->
    <div v-if="phase === 'setup' || phase === 'loading'" class="setup absolute inset-0 overflow-y-auto">
      <div class="glow-a" aria-hidden="true" />
      <div class="glow-b" aria-hidden="true" />
      <button class="absolute top-5 right-5 z-10 rounded-lg px-3 py-1.5 text-sm font-semibold text-neutral-400 ring-1 ring-white/10 hover:text-white" @click="quit">Fermer</button>

      <div class="relative mx-auto flex min-h-full max-w-5xl flex-col justify-center gap-10 px-6 py-16 lg:flex-row lg:items-center">
        <!-- Pochette et titre -->
        <div class="flex-1">
          <div class="cover-xl mb-6 flex size-40 items-center justify-center rounded-3xl text-5xl font-black">{{ song.title.slice(0, 2).toUpperCase() }}</div>
          <div class="text-xs font-bold tracking-[0.3em] text-copper-400 uppercase">Prêt à jouer</div>
          <h1 class="mt-2 text-5xl leading-none font-black tracking-tight text-white">{{ song.title }}</h1>
          <p v-if="song.artist" class="mt-3 text-xl text-neutral-400">{{ song.artist }}</p>
          <div class="mt-5 flex flex-wrap gap-2 text-xs text-neutral-400">
            <span v-if="song.tempo" class="chip-info">{{ song.tempo }} BPM</span>
            <span v-if="selectedTrack" class="chip-info">Accordage : {{ tuningName(selectedTrack.tuning) }}</span>
          </div>
          <p v-if="selectedTrack && tuningName(selectedTrack.tuning) !== 'Standard'" class="mt-3 text-sm text-amber-300">Pense à accorder ta guitare : {{ tuningName(selectedTrack.tuning) }}.</p>
        </div>

        <!-- Réglages -->
        <div class="panel w-full max-w-md space-y-6 rounded-3xl p-6">
          <div>
            <div class="label">Ta piste</div>
            <div class="grid gap-2">
              <button v-for="t in tracks" :key="t.index" class="option" :class="{ on: trackIndex === t.index }" @click="trackIndex = t.index">
                <span class="font-bold">{{ t.name }}</span>
                <span class="text-xs opacity-60">{{ t.strings }} cordes · {{ t.notes }} notes</span>
              </button>
              <p v-if="!tracks.length && !error" class="text-sm text-neutral-500">Lecture du fichier…</p>
            </div>
          </div>
          <div>
            <div class="label">Vitesse <span class="text-copper-300">{{ Math.round(speed * 100) }} %</span></div>
            <div class="flex gap-1.5">
              <button v-for="s in SPEEDS" :key="s" class="speed" :class="{ on: speed === s }" @click="speed = s">{{ Math.round(s * 100) }}</button>
            </div>
          </div>
          <label class="flex cursor-pointer items-start gap-3">
            <input v-model="dynamic" type="checkbox" class="peer sr-only" />
            <span class="toggle mt-0.5" />
            <span>
              <span class="block font-semibold">Difficulté dynamique</span>
              <span class="block text-xs text-neutral-500">Moins de notes au début, la partition se remplit quand tu joues juste.</span>
            </span>
          </label>
          <div>
            <div class="label">Batterie</div>
            <div class="flex gap-1.5">
              <button class="speed flex-1" :class="{ on: synthDrums }" @click="synthDrums = true">Synthé</button>
              <button class="speed flex-1" :class="{ on: !synthDrums }" @click="synthDrums = false">Kit réaliste</button>
            </div>
          </div>

          <button class="go relative w-full overflow-hidden rounded-2xl py-4 text-xl font-black tracking-wider italic" :disabled="phase === 'loading' || trackIndex === null" @click="start">
            <span class="fill" :style="{ width: (phase === 'loading' ? loading * 100 : 0) + '%' }" />
            <span class="relative">{{ phase === 'loading' ? `PRÉPARATION ${Math.round(loading * 100)} %` : 'JOUER' }}</span>
          </button>
          <p v-if="error" class="text-sm text-rose-300">{{ error }}</p>
          <p class="text-center text-xs text-neutral-500">Plein écran · Espace ou Échap pour la pause</p>
        </div>
      </div>
    </div>

    <!-- ========== Autoroute ========== -->
    <div v-show="phase === 'playing' || phase === 'paused' || phase === 'results'" class="absolute inset-0">
      <canvas ref="canvas" class="block size-full" />

      <!-- HUD du haut -->
      <div class="hud-top pointer-events-none absolute inset-x-0 top-0 flex items-start gap-6 px-6 pt-4">
        <div class="min-w-0 flex-1">
          <div class="truncate text-lg font-black text-white">{{ song.title }}</div>
          <div class="truncate text-sm text-neutral-400">{{ song.artist }}<template v-if="selectedTrack"> · {{ selectedTrack.name }}</template></div>
        </div>
        <!-- Progression par section (cliquables en pause : Riff Repeater) -->
        <div class="w-[42%] max-w-2xl pt-1">
          <div class="flex h-2.5 gap-0.5">
            <div v-for="(s, i) in sectionBars" :key="i" class="relative h-full overflow-hidden rounded-full" :style="{ width: s.width + '%', background: accColor(s.acc) }" :class="{ 'ring-2 ring-white/60': s.current }" :title="s.name" />
          </div>
          <div class="relative mt-1 h-0">
            <div class="absolute -top-4 h-5 w-0.5 rounded bg-white shadow-[0_0_10px_white]" :style="{ left: progress * 100 + '%' }" />
          </div>
          <div class="mt-2 flex justify-between text-[11px] text-neutral-500 tabular-nums">
            <span>{{ hud.section >= 0 ? chart?.sections[hud.section]?.name : '' }}</span>
            <span>{{ clock(songPos) }} / {{ clock(chart?.duration ?? 0) }}</span>
          </div>
        </div>
        <div class="flex-1 text-right">
          <div class="score text-4xl font-black tabular-nums">{{ hud.score.toLocaleString('fr-FR') }}</div>
          <div class="mt-1 flex items-center justify-end gap-2">
            <span class="text-xs text-neutral-400 tabular-nums">série {{ hud.streak }}</span>
            <span class="mult" :class="`m${hud.mult}`">×{{ hud.mult }}</span>
          </div>
        </div>
      </div>

      <!-- Bandeau de section / niveau -->
      <transition name="banner">
        <div v-if="banner" :key="banner.id" class="pointer-events-none absolute inset-x-0 top-[18%] text-center">
          <div class="banner-title text-5xl font-black tracking-tight italic">{{ banner.title }}</div>
          <div v-if="banner.sub" class="mt-1 text-sm font-semibold tracking-[0.3em] text-copper-300 uppercase">{{ banner.sub }}</div>
        </div>
      </transition>

      <!-- Décompte -->
      <div v-if="hud.countIn && phase === 'playing'" :key="hud.countIn" class="countin pointer-events-none absolute inset-0 flex items-center justify-center text-[160px] font-black italic">{{ hud.countIn }}</div>

      <!-- Jugements -->
      <div class="pointer-events-none absolute inset-x-0 bottom-[30%] flex flex-col items-center">
        <span v-for="p in popups" :key="p.id" class="judge" :class="p.kind">{{ p.text }}</span>
      </div>

      <!-- HUD du bas -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-6 pb-4 text-xs text-neutral-400">
        <div class="flex items-center gap-4">
          <span class="badge">Précision <b class="text-white">{{ Math.round(hud.accuracy * 100) }} %</b></span>
          <span v-if="dynamic" class="badge">Niveau <b class="text-white">{{ hud.level }}/{{ LEVELS }}</b></span>
          <span class="badge">Vitesse <b class="text-white">{{ Math.round((riff?.speed ?? speed) * 100) }} %</b></span>
          <span v-if="heard" :key="heard.id" class="heard">Entendu : <b class="text-white">{{ heard.name }}</b></span>
          <span v-if="!audio.running.value" class="badge !text-amber-300">Micro coupé : clique sur Pause → Réglages</span>
        </div>
        <div class="flex items-center gap-3">
          <span v-if="riff" class="riff-badge">RIFF REPEATER · {{ chart.sections[riff.section].name }} · passage {{ riff.pass }}{{ riff.rendering ? ' · préparation…' : '' }}</span>
          <span>Espace : pause</span>
        </div>
      </div>

      <!-- Légende des cordes -->
      <div class="pointer-events-none absolute top-1/2 left-4 flex -translate-y-1/2 flex-col gap-1.5">
        <span v-for="(c, s) in STRING_COLORS.slice(0, selectedTrack?.strings ?? 6)" :key="s" class="flex items-center gap-2 text-[11px] font-bold text-neutral-400">
          <span class="h-1.5 w-5 rounded-full" :style="{ background: c, boxShadow: `0 0 8px ${c}` }" />
          {{ noteName(selectedTrack?.tuning[s] ?? 0, 'fr') }}
        </span>
      </div>

      <!-- ========== Pause ========== -->
      <div v-if="phase === 'paused'" class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md">
        <div class="panel w-full max-w-2xl rounded-3xl p-7">
          <div class="flex items-baseline justify-between">
            <h2 class="text-4xl font-black tracking-tight italic">PAUSE</h2>
            <span class="text-sm text-neutral-400 tabular-nums">{{ clock(songPos) }} · {{ hud.score.toLocaleString('fr-FR') }} pts</span>
          </div>
          <div class="mt-5 grid grid-cols-3 gap-2">
            <button class="go rounded-xl py-3 font-black italic" @click="resume"><span class="relative">{{ riff ? 'REPRENDRE LA BOUCLE' : 'REPRENDRE' }}</span></button>
            <button class="ghost" @click="restart">Recommencer</button>
            <button class="ghost" @click="quit">Quitter</button>
          </div>

          <!-- Riff Repeater -->
          <div class="mt-7">
            <div class="flex items-center justify-between">
              <div class="label !mb-0">Riff Repeater · choisis une section à boucler</div>
              <button v-if="riff" class="text-xs font-semibold text-copper-300 hover:text-copper-200" @click="leaveRiff">Revenir au morceau entier →</button>
            </div>
            <div class="mt-3 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
              <button v-for="(s, i) in chart?.sections ?? []" :key="i" class="section-btn" :class="{ on: riff?.section === i }" @click="startRiff(i)">
                <span class="truncate font-semibold">{{ s.name }}</span>
                <span class="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10"><span class="block h-full" :style="{ width: (mainSession?.sectionStats[i]?.total ? (mainSession.sectionStats[i].hits / mainSession.sectionStats[i].total) * 100 : 0) + '%', background: accColor(mainSession?.sectionStats[i]?.total ? mainSession.sectionStats[i].hits / mainSession.sectionStats[i].total : null) }" /></span>
              </button>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <span class="text-neutral-400">Vitesse de départ</span>
              <div class="flex gap-1">
                <button v-for="s in SPEEDS" :key="s" class="speed !px-2 !py-1 text-xs" :class="{ on: riffSpeed === s }" @click="riffSpeed = s">{{ Math.round(s * 100) }}</button>
              </div>
              <label class="flex cursor-pointer items-center gap-2">
                <input v-model="riffAuto" type="checkbox" class="peer sr-only" />
                <span class="toggle" />
                <span class="text-neutral-300">Accélérer quand c'est réussi</span>
              </label>
            </div>
          </div>

          <!-- Réglages -->
          <div class="mt-7 grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="label">Synchro du jeu <span class="text-copper-300">{{ offsetMs > 0 ? '+' : '' }}{{ offsetMs }} ms</span></span>
              <input v-model.number="offsetMs" type="range" min="-150" max="250" step="10" class="w-full accent-copper-400" @change="save('offsetMs', offsetMs)" />
              <span class="text-[11px] text-neutral-500">Monte la valeur si tes notes justes sont comptées « en retard ».</span>
            </label>
            <label class="block">
              <span class="label">Volume de l'accompagnement <span class="text-copper-300">{{ Math.round(backingVolume * 100) }} %</span></span>
              <input v-model.number="backingVolume" type="range" min="0" max="4" step="0.1" class="w-full accent-copper-400" @input="transport.setVolume(backingVolume)" @change="save('backingGain', backingVolume)" />
              <span v-if="!audio.running.value" class="mt-1 flex items-center gap-2 text-[11px] text-amber-300">
                Micro coupé. <button class="font-bold underline pointer-events-auto" @click="audio.start()">Activer l'entrée audio</button>
              </span>
              <span v-if="audio.error.value" class="text-[11px] text-rose-300">{{ audio.error.value }}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- ========== Bilan ========== -->
      <div v-if="phase === 'results' && results" class="results absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-md">
        <div class="w-full max-w-3xl px-6 py-10 text-center">
          <div class="text-xs font-bold tracking-[0.4em] text-copper-400 uppercase">{{ song.title }}</div>
          <div class="rank mx-auto mt-4" :class="`r${results.rank}`">{{ results.rank }}</div>
          <div class="mt-2 text-6xl font-black tabular-nums">{{ shownScore.toLocaleString('fr-FR') }}</div>
          <div v-if="results.newRecord" class="mt-2 text-sm font-black tracking-[0.3em] text-copper-300 uppercase">Nouveau record !</div>
          <div v-else class="mt-2 text-sm text-neutral-500">Record : {{ results.record.toLocaleString('fr-FR') }}</div>

          <div class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="stat"><b>{{ Math.round(results.accuracy * 100) }} %</b><span>précision</span></div>
            <div class="stat"><b>{{ results.hits }}/{{ results.total }}</b><span>notes</span></div>
            <div class="stat"><b>{{ results.perfects }}</b><span>parfaites</span></div>
            <div class="stat"><b>{{ results.bestStreak }}</b><span>plus longue série</span></div>
          </div>

          <div class="mt-8 space-y-1.5 text-left">
            <div v-for="(s, i) in results.sections" :key="i" class="flex items-center gap-3 text-sm">
              <span class="w-40 truncate text-neutral-400">{{ s.name }}</span>
              <span class="h-2 flex-1 overflow-hidden rounded-full bg-white/8"><span class="block h-full rounded-full" :style="{ width: (s.total ? (s.hits / s.total) * 100 : 0) + '%', background: accColor(s.total ? s.hits / s.total : null) }" /></span>
              <span class="w-12 text-right text-neutral-400 tabular-nums">{{ s.total ? Math.round((s.hits / s.total) * 100) + ' %' : '—' }}</span>
            </div>
          </div>

          <div class="mt-9 flex flex-wrap justify-center gap-3">
            <button class="go rounded-xl px-8 py-3 font-black italic" @click="restart"><span class="relative">REJOUER</span></button>
            <button v-if="worstSection" class="ghost" @click="startRiff(worstSection.i)">Travailler « {{ worstSection.name }} » au Riff Repeater</button>
            <button class="ghost" @click="quit">Retour aux morceaux</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.play {
  background: #0b0908;
}
/* ---------- Préparation ---------- */
.setup {
  background:
    radial-gradient(ellipse 60% 50% at 20% 30%, color-mix(in srgb, var(--color-copper-500) 22%, transparent), transparent 70%),
    radial-gradient(ellipse 50% 60% at 85% 80%, rgba(56, 189, 248, 0.08), transparent 70%),
    #0b0908;
}
.glow-a,
.glow-b {
  position: absolute;
  border-radius: 999px;
  filter: blur(80px);
  pointer-events: none;
}
.glow-a {
  width: 420px;
  height: 420px;
  left: 8%;
  top: 12%;
  background: color-mix(in srgb, var(--color-copper-500) 30%, transparent);
  animation: drift 9s ease-in-out infinite alternate;
}
.glow-b {
  width: 320px;
  height: 320px;
  right: 10%;
  bottom: 8%;
  background: rgba(251, 191, 36, 0.12);
  animation: drift 11s ease-in-out infinite alternate-reverse;
}
@keyframes drift {
  to {
    transform: translate(60px, 40px) scale(1.15);
  }
}
.cover-xl {
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.3), transparent 55%),
    linear-gradient(135deg, var(--color-copper-400), #3b2a20 85%);
  box-shadow:
    0 30px 80px -20px color-mix(in srgb, var(--color-copper-500) 70%, transparent),
    inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.chip-info {
  border-radius: 999px;
  padding: 4px 12px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.panel {
  background: rgba(20, 18, 17, 0.78);
  backdrop-filter: blur(18px);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 40px 100px -30px rgba(0, 0, 0, 0.9);
}
.label {
  margin-bottom: 8px;
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #a8a29e;
}
.option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  border-radius: 14px;
  padding: 12px 14px;
  text-align: left;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition: all 0.15s;
}
.option:hover {
  background: rgba(255, 255, 255, 0.07);
}
.option.on {
  background: color-mix(in srgb, var(--color-copper-500) 18%, transparent);
  box-shadow: inset 0 0 0 2px var(--color-copper-400);
}
.speed {
  border-radius: 10px;
  padding: 8px 0;
  min-width: 46px;
  font-size: 13px;
  font-weight: 800;
  color: #d6d3d1;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.speed.on {
  color: #fff;
  background: var(--color-copper-500);
  box-shadow: none;
}
.toggle {
  position: relative;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 999px;
  background: #44403c;
  transition: background 0.2s;
}
.toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  transition: transform 0.2s;
}
.peer:checked + .toggle {
  background: var(--color-copper-500);
}
.peer:checked + .toggle::after {
  transform: translateX(16px);
}
.go {
  color: #fff;
  background: linear-gradient(180deg, var(--color-copper-400), var(--color-copper-600));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 4px 0 color-mix(in srgb, var(--color-copper-600) 60%, #000),
    0 14px 40px -8px color-mix(in srgb, var(--color-copper-500) 80%, transparent);
  transition:
    transform 0.15s,
    filter 0.15s;
}
.go:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.08);
}
.go:disabled {
  cursor: progress;
}
.go .fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(255, 255, 255, 0.22);
  transition: width 0.2s;
}
.ghost {
  border-radius: 12px;
  padding: 12px 18px;
  font-weight: 700;
  color: #e7e5e4;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.ghost:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* ---------- HUD ---------- */
.hud-top {
  background: linear-gradient(180deg, rgba(11, 9, 8, 0.85), transparent);
  padding-bottom: 40px;
}
.score {
  background: linear-gradient(180deg, #fff, var(--color-copper-300));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 18px color-mix(in srgb, var(--color-copper-500) 50%, transparent));
}
.mult {
  border-radius: 8px;
  padding: 2px 10px;
  font-size: 18px;
  font-weight: 900;
  font-style: italic;
  background: rgba(255, 255, 255, 0.08);
  transition: all 0.2s;
}
.mult.m2 {
  background: color-mix(in srgb, var(--color-copper-500) 40%, transparent);
}
.mult.m3 {
  background: var(--color-copper-500);
  box-shadow: 0 0 20px var(--color-copper-500);
}
.mult.m4 {
  background: linear-gradient(90deg, #f97316, #ef4444);
  box-shadow: 0 0 28px #f97316;
  animation: fire 0.5s ease-in-out infinite alternate;
}
@keyframes fire {
  to {
    box-shadow: 0 0 40px #ef4444;
  }
}
.badge {
  border-radius: 999px;
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.45);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.heard {
  animation: heard 0.6s ease-out;
}
@keyframes heard {
  from {
    color: var(--color-copper-300);
  }
}
.riff-badge {
  border-radius: 999px;
  padding: 6px 14px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #fff;
  background: linear-gradient(90deg, var(--color-copper-500), #b45309);
  box-shadow: 0 0 24px color-mix(in srgb, var(--color-copper-500) 60%, transparent);
}
.banner-title {
  background: linear-gradient(180deg, #fff 30%, var(--color-copper-300));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 4px 24px rgba(0, 0, 0, 0.9));
}
.banner-enter-active {
  animation: banner-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.banner-leave-active {
  transition: opacity 0.4s;
}
.banner-leave-to {
  opacity: 0;
}
@keyframes banner-in {
  from {
    opacity: 0;
    transform: scale(1.4);
    letter-spacing: 0.2em;
  }
}
.countin {
  color: #fff;
  -webkit-text-stroke: 2px var(--color-copper-400);
  text-shadow:
    0 6px 0 color-mix(in srgb, var(--color-copper-600) 70%, #000),
    0 0 24px color-mix(in srgb, var(--color-copper-500) 55%, transparent);
  animation: count 0.5s ease-out both;
}
@keyframes count {
  from {
    opacity: 0;
    transform: scale(1.8);
  }
}
.judge {
  font-size: 30px;
  font-weight: 900;
  font-style: italic;
  letter-spacing: 0.02em;
  animation: judge 0.9s ease-out forwards;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
}
.judge.perfect {
  color: #fde3c8;
  text-shadow:
    0 0 18px var(--color-copper-400),
    0 4px 20px rgba(0, 0, 0, 0.9);
}
.judge.good {
  font-size: 22px;
  color: #d6d3d1;
}
.judge.mult {
  font-size: 40px;
  background: linear-gradient(90deg, #fbbf24, #f97316, #ef4444);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 16px rgba(249, 115, 22, 0.7));
}
@keyframes judge {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.7);
  }
  15% {
    opacity: 1;
    transform: translateY(0) scale(1.1);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-30px);
  }
}
.section-btn {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  border-radius: 12px;
  padding: 10px 12px;
  text-align: left;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.section-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.section-btn.on {
  box-shadow: inset 0 0 0 2px var(--color-copper-400);
}

/* ---------- Bilan ---------- */
.rank {
  display: flex;
  width: 150px;
  height: 150px;
  align-items: center;
  justify-content: center;
  border-radius: 40px;
  font-size: 110px;
  font-weight: 900;
  font-style: italic;
  animation: rank-in 0.8s cubic-bezier(0.2, 1.5, 0.4, 1) both;
}
.rank.rS {
  background: linear-gradient(135deg, #fde68a, var(--color-copper-500));
  color: #1c1917;
  box-shadow: 0 0 80px color-mix(in srgb, var(--color-copper-500) 80%, transparent);
}
.rank.rA {
  background: linear-gradient(135deg, var(--color-copper-300), var(--color-copper-600));
  color: #fff;
  box-shadow: 0 0 60px color-mix(in srgb, var(--color-copper-500) 60%, transparent);
}
.rank.rB,
.rank.rC {
  background: rgba(255, 255, 255, 0.08);
  color: #e7e5e4;
}
@keyframes rank-in {
  from {
    opacity: 0;
    transform: scale(2.2) rotate(-12deg);
  }
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 16px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.stat b {
  font-size: 26px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.stat span {
  font-size: 12px;
  color: #a8a29e;
}
</style>
