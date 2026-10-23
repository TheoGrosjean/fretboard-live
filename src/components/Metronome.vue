<script setup>
// Métronome : tempo (40–240), tap tempo, mesure, accent sur le 1er temps.
// Les clics sont programmés sur l'horloge audio avec un peu d'avance : le tempo ne dérive jamais.
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({ shortcuts: { type: Boolean, default: true } }) // false : clavier laissé au mode jeu

function stored(key, initial) {
  try {
    const v = localStorage.getItem(`fb.metronome.${key}`)
    return v !== null ? JSON.parse(v) : initial
  } catch {
    return initial
  }
}
const bpm = ref(stored('bpm', 90))
const beats = ref(stored('beats', 4)) // temps par mesure
const accent = ref(stored('accent', true))
const volume = ref(stored('volume', 0.7))
const subdiv = ref(stored('subdiv', 1)) // clics par temps : 1 noire, 2 croches, 3 triolet, 4 doubles croches
watch([bpm, beats, accent, volume, subdiv], () => {
  localStorage.setItem('fb.metronome.bpm', JSON.stringify(bpm.value))
  localStorage.setItem('fb.metronome.beats', JSON.stringify(beats.value))
  localStorage.setItem('fb.metronome.accent', JSON.stringify(accent.value))
  localStorage.setItem('fb.metronome.volume', JSON.stringify(volume.value))
  localStorage.setItem('fb.metronome.subdiv', JSON.stringify(subdiv.value))
})

const MIN = 40
const MAX = 240
const SIGNATURES = [2, 3, 4, 6]
const SUBDIVISIONS = [
  { n: 1, label: '♩', name: 'Noires' },
  { n: 2, label: '♫', name: 'Croches' },
  { n: 3, label: '♫', tuplet: 3, name: 'Triolets' },
  { n: 4, label: '♬', name: 'Doubles croches' },
]
const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(v)))
const setBpm = (v) => (bpm.value = clamp(v))

// Nom du tempo, à l'italienne (repère musical)
const tempoName = computed(() => {
  const v = bpm.value
  return v < 60 ? 'Largo' : v < 76 ? 'Adagio' : v < 108 ? 'Andante' : v < 120 ? 'Moderato' : v < 168 ? 'Allegro' : 'Presto'
})

// ---------- Son et horloge ----------
const LOOKAHEAD = 0.12 // s programmées à l'avance
let ctx = null
let out = null
let timer = 0
let nextTime = 0
let beatIndex = 0
let subIndex = 0 // subdivision dans le temps
const playing = ref(false)
const current = ref(-1) // temps qui vient de sonner (pour les pastilles)
const pending = [] // { time, beat } : temps programmés, affichés quand ils sonnent

// level : 2 premier temps accentué, 1 temps, 0 subdivision (plus grave et discrète)
function click(time, level) {
  // Clic court et boisé : une sinusoïde aiguë qui s'éteint en 40 ms
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = [880, 1175, 1760][level]
  gain.gain.setValueAtTime(0, time)
  gain.gain.linearRampToValueAtTime([0.3, 0.6, 1][level], time + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045)
  osc.connect(gain).connect(out)
  osc.start(time)
  osc.stop(time + 0.06)
}

function schedule() {
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    if (subIndex === 0) {
      click(nextTime, accent.value && beatIndex === 0 ? 2 : 1)
      pending.push({ time: nextTime, beat: beatIndex })
    } else click(nextTime, 0)
    nextTime += 60 / bpm.value / subdiv.value
    if (++subIndex >= subdiv.value) {
      subIndex = 0
      beatIndex = (beatIndex + 1) % beats.value
    }
  }
  // Pastille du temps qui sonne maintenant (latence de sortie comprise)
  const heard = ctx.currentTime - (ctx.outputLatency || 0)
  while (pending.length && pending[0].time <= heard) current.value = pending.shift().beat
}

async function start() {
  ctx ??= new AudioContext({ latencyHint: 'interactive' })
  out ??= ctx.createGain()
  out.connect(ctx.destination)
  out.gain.value = volume.value
  await ctx.resume()
  beatIndex = 0
  subIndex = 0
  pending.length = 0
  nextTime = ctx.currentTime + 0.05
  timer = setInterval(schedule, 20)
  playing.value = true
}
function stop() {
  clearInterval(timer)
  timer = 0
  playing.value = false
  current.value = -1
  pending.length = 0
}
const toggle = () => (playing.value ? stop() : start())
watch(volume, (v) => out?.gain.setTargetAtTime(v, ctx.currentTime, 0.02))
watch(beats, () => (beatIndex %= beats.value))
onBeforeUnmount(() => {
  stop()
  ctx?.close()
})

// ---------- Clavier : Espace lance/arrête, ↑ ↓ ±1 BPM (±5 avec Maj), ← → changent de rythme ----------
function onKey(e) {
  if (!props.shortcuts || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return
  const step = e.shiftKey ? 5 : 1
  if (e.code === 'Space') toggle()
  else if (e.key === 'ArrowUp') setBpm(bpm.value + step)
  else if (e.key === 'ArrowDown') setBpm(bpm.value - step)
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const i = SUBDIVISIONS.findIndex((d) => d.n === subdiv.value) + (e.key === 'ArrowRight' ? 1 : -1)
    subdiv.value = SUBDIVISIONS[(i + SUBDIVISIONS.length) % SUBDIVISIONS.length].n
  }
  else return
  e.preventDefault() // pas de défilement, ni de clic sur le bouton qui a le focus
}
const listen = (on) => window[on ? 'addEventListener' : 'removeEventListener']('keydown', onKey)
onMounted(() => listen(true))
onActivated(() => listen(true))
// La page Manche est gardée en mémoire : en changeant d'onglet, on coupe le son et le clavier
onDeactivated(() => {
  stop()
  listen(false)
})
onBeforeUnmount(() => listen(false))

// ---------- Tap tempo : moyenne des derniers intervalles ----------
let taps = []
function tap() {
  const now = performance.now()
  if (taps.length && now - taps.at(-1) > 2000) taps = [] // pause trop longue : on recommence
  taps.push(now)
  taps = taps.slice(-6)
  if (taps.length < 2) return
  const gaps = taps.slice(1).map((t, i) => t - taps[i])
  setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length))
}
</script>

<template>
  <section class="metro flex min-h-0 flex-col rounded-2xl bg-neutral-900 px-5 py-3.5 ring-1 ring-white/5">
    <div class="metro-inner flex h-full flex-col">
      <!-- 3 colonnes : le choix du rythme reste centré au-dessus du tempo -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <div class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Métronome</div>
        <!-- Subdivision du temps -->
        <div class="flex rounded-xl bg-neutral-800 p-1">
          <button v-for="d in SUBDIVISIONS" :key="d.n" class="sub" :class="{ on: subdiv === d.n }" :title="`${d.name} (← →)`" :aria-label="d.name" @click="subdiv = d.n">
            {{ d.label }}<sup v-if="d.tuplet" class="-ml-px text-[11px] font-bold">{{ d.tuplet }}</sup>
          </button>
        </div>
        <div class="flex items-center justify-end gap-2 text-neutral-500">
          <!-- Raccourcis clavier : info-bulle au survol (ou au focus clavier) -->
          <div class="group relative">
            <button class="flex size-6 items-center justify-center rounded-md text-neutral-500 transition hover:bg-white/5 hover:text-neutral-200" aria-label="Raccourcis clavier" aria-describedby="metro-keys">
              <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.75" r="0.6" fill="currentColor" /></svg>
            </button>
            <div id="metro-keys" role="tooltip" class="keys pointer-events-none invisible absolute top-full right-0 z-50 mt-2 w-60 rounded-xl p-3 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <div class="mb-2 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Raccourcis clavier</div>
              <dl class="space-y-1.5 text-xs text-neutral-300">
                <div class="flex items-center justify-between gap-3"><dt><kbd>Espace</kbd></dt><dd>Lancer / arrêter</dd></div>
                <div class="flex items-center justify-between gap-3"><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>±1 BPM</dd></div>
                <div class="flex items-center justify-between gap-3"><dt><kbd>Maj</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></dt><dd>±5 BPM</dd></div>
                <div class="flex items-center justify-between gap-3"><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Changer de rythme</dd></div>
              </dl>
            </div>
          </div>
          <Icon name="volume" class="size-3.5" />
          <input v-model.number="volume" type="range" min="0" max="1" step="0.01" class="w-12 min-w-0 accent-copper-400" aria-label="Volume du métronome" />
        </div>
      </div>

      <!-- Tempo : − 90 + , puis le nom du tempo et les temps de la mesure -->
      <div class="tempo flex flex-1 flex-col items-center justify-center">
        <div class="flex items-center gap-5">
          <button class="step" title="−5 BPM (flèche ↓ : −1)" @click="setBpm(bpm - 5)">−</button>
          <div class="bpm w-28 text-center leading-none font-black text-white tabular-nums">{{ bpm }}</div>
          <button class="step" title="+5 BPM (flèche ↑ : +1)" @click="setBpm(bpm + 5)">+</button>
        </div>
        <div class="tempo-name mt-1.5 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">BPM · {{ tempoName }}</div>
        <div class="beats mt-3 flex w-full max-w-64 gap-1.5">
          <span v-for="b in beats" :key="b" class="beat" :class="{ on: current === b - 1, strong: accent && b === 1 }" />
        </div>
        <input :value="bpm" type="range" :min="MIN" :max="MAX" step="1" class="tempo-slider mt-4 w-full max-w-64 accent-copper-400" aria-label="Tempo" @input="setBpm(Number($event.target.value))" />
      </div>

      <!-- Commandes -->
      <div class="flex items-center gap-2">
        <div class="flex overflow-hidden rounded-lg bg-neutral-800 p-0.5 text-xs font-bold">
          <button v-for="s in SIGNATURES" :key="s" class="sig" :class="{ on: beats === s }" @click="beats = s">{{ s }}/{{ s === 6 ? 8 : 4 }}</button>
        </div>
        <button class="chip" :class="{ 'is-on': accent }" title="Accent sur le premier temps" @click="accent = !accent">1&gt;</button>
        <button class="chip ml-auto" title="Tape le rythme pour régler le tempo" @click="tap">Tap</button>
        <button class="play" :class="{ on: playing }" :title="(playing ? 'Arrêter' : 'Lancer') + ' (Espace)'" @click="toggle">
          <Icon :name="playing ? 'stop' : 'play'" class="size-4" />
          {{ playing ? 'Stop' : 'Lancer' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
@reference "../style.css";

.metro {
  container-type: size;
}
.bpm {
  font-size: 3rem;
}
.step {
  @apply flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xl font-bold text-neutral-300 transition hover:bg-neutral-700 hover:text-white;
}
.beat {
  @apply h-2 flex-1 rounded-full bg-neutral-800 transition-all duration-75;
}
.beat.strong {
  @apply bg-neutral-700;
}
.beat.on {
  @apply bg-copper-400 shadow-[0_0_12px] shadow-copper-400/70;
}
.beat.on.strong {
  @apply bg-white shadow-white/70;
}
.play {
  @apply flex h-9 items-center gap-2 rounded-xl bg-copper-500 px-4 text-sm font-bold text-white transition hover:bg-copper-400;
}
.play.on {
  @apply bg-neutral-800 text-neutral-200 hover:bg-neutral-700;
}
.chip {
  @apply h-9 rounded-xl px-3 text-sm font-bold text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white;
}
.chip.is-on {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40;
}
.sig {
  @apply rounded-md px-2 py-1.5 text-neutral-400 transition hover:text-white;
}
.sub {
  @apply flex h-8 w-12 items-center justify-center rounded-lg text-2xl leading-none text-neutral-400 transition hover:text-white;
}
.sub.on {
  @apply bg-copper-500 text-white;
}
.keys {
  background: #1a1817;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 20px 50px -12px rgba(0, 0, 0, 0.8);
}
kbd {
  @apply inline-flex h-5 min-w-5 items-center justify-center rounded bg-neutral-800 px-1.5 font-sans text-[11px] font-semibold text-neutral-200 ring-1 ring-white/10;
}
.sig.on {
  @apply bg-copper-500 text-white;
}
/* Requêtes de hauteur en dernier : elles l'emportent sur les styles de base */
/* Peu de hauteur : tempo plus compact, sans curseur */
@container (max-height: 250px) {
  .tempo-slider {
    display: none;
  }
}
@container (max-height: 200px) {
  .bpm {
    font-size: 2.25rem;
  }
  .beats {
    margin-top: 0.5rem;
  }
}
@container (max-height: 160px) {
  .tempo-name {
    display: none;
  }
  .bpm {
    font-size: 2rem;
  }
  .sub {
    height: 1.5rem;
    font-size: 1.125rem;
  }
  .step {
    width: 2rem;
    height: 2rem;
  }
  .beats {
    margin-top: 0.375rem;
  }
}
/* Beaucoup de hauteur : le tempo prend la place */
@container (min-height: 320px) {
  .bpm {
    font-size: 4.5rem;
  }
  .beats {
    margin-top: 1.25rem;
  }
}
</style>
