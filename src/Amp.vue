<script setup>
// Onglet « Ampli » (phase de test) : la guitare passe dans un mini simulateur d'ampli, en direct
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Knob from './components/amp/Knob.vue'
import Icon from './components/Icon.vue'
import { DEFAULT_PRESET, PRESETS, createAmp } from './lib/ampChain'
import { DEFAULT_BODY_FINISH, applyAccent } from './lib/noteStyles'

// Même couleur d'accent que la guitare choisie sur le manche
function stored(key, initial) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? initial : JSON.parse(v)
  } catch {
    return initial
  }
}
applyAccent(stored('fb.bodyFinish', DEFAULT_BODY_FINISH))

const KNOBS = [
  { id: 'gate', label: 'Gate', group: 'pre' },
  { id: 'gain', label: 'Gain', group: 'pre' },
  { id: 'bass', label: 'Bass', group: 'eq' },
  { id: 'mid', label: 'Middle', group: 'eq' },
  { id: 'treble', label: 'Treble', group: 'eq' },
  { id: 'presence', label: 'Presence', group: 'eq' },
  { id: 'master', label: 'Master', group: 'out' },
  { id: 'reverb', label: 'Reverb', group: 'fx' },
  { id: 'delay', label: 'Delay', group: 'fx' },
]
const PRESET_NAMES = { clean: 'Clean', crunch: 'Crunch', lead: 'Lead' }
// Pédales du pédalier (une par preset)
const PEDALS = [
  { id: 'clean', name: 'Clean', sub: 'Sparkle', body: '#d8cfbd', ink: '#2b2520' },
  { id: 'crunch', name: 'Crunch', sub: 'Plexi drive', body: 'var(--color-copper-500)', ink: '#1a1410' },
  { id: 'lead', name: 'Lead', sub: 'Hot rod', body: '#9f1d1d', ink: '#fde8e8' },
]
const TUBES = 4

// Vu-mètre : aiguille de -48° à +48°
const needle = (v) => -48 + v * 96
const VU_TICKS = [
  { v: 0, t: '-20' },
  { v: 0.28, t: '-10' },
  { v: 0.5, t: '-5' },
  { v: 0.72, t: '0' },
  { v: 0.86, t: '+3', red: true },
  { v: 1, t: '' , red: true },
].map((k) => {
  const a = ((needle(k.v) - 90) * Math.PI) / 180
  return { ...k, x1: 100 + 78 * Math.cos(a), y1: 112 + 78 * Math.sin(a), x2: 100 + 88 * Math.cos(a), y2: 112 + 88 * Math.sin(a), tx: 100 + 99 * Math.cos(a), ty: 112 + 99 * Math.sin(a) }
})
const vuArc = (from, to, r = 84) => {
  const p = (v) => {
    const a = ((needle(v) - 90) * Math.PI) / 180
    return `${100 + r * Math.cos(a)} ${112 + r * Math.sin(a)}`
  }
  return `M ${p(from)} A ${r} ${r} 0 0 1 ${p(to)}`
}

const params = ref({ ...PRESETS[DEFAULT_PRESET], ...stored('fb.amp.params', {}) })
const preset = computed(() => Object.keys(PRESETS).find((k) => KNOBS.every((kn) => PRESETS[k][kn.id] === params.value[kn.id])) ?? null)
watch(params, (p) => {
  localStorage.setItem('fb.amp.params', JSON.stringify(p))
  amp?.set(p)
}, { deep: true })

// ---------- Entrée / sortie audio ----------
const inputs = ref([])
const outputs = ref([])
const deviceId = ref(localStorage.getItem('fb.deviceId') || '')
const channel = ref(localStorage.getItem('fb.channel') || 'mix')
const outputId = ref(localStorage.getItem('fb.amp.output') || '')
const canPickOutput = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

const running = ref(false)
const error = ref('')
const latency = ref(null)
const inLevel = ref(0)
const outLevel = ref(0)
const gateOpen = ref(false)

let ctx = null
let stream = null
let amp = null
let source = null
let splitter = null
let raf = 0

async function refreshDevices() {
  const all = await navigator.mediaDevices.enumerateDevices()
  inputs.value = all.filter((d) => d.kind === 'audioinput' && d.deviceId)
  outputs.value = all.filter((d) => d.kind === 'audiooutput' && d.deviceId)
}

const meter = (db) => Math.min(1, Math.max(0, (db + 72) / 72))

async function start() {
  error.value = ''
  stop()
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId.value ? { exact: deviceId.value } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    })
    await refreshDevices()
    // Au premier lancement, on prend la Focusrite si elle est branchée
    if (!deviceId.value) {
      const focusrite = inputs.value.find((d) => /focusrite|scarlett|clarett|vocaster/i.test(d.label))
      if (focusrite) {
        deviceId.value = focusrite.deviceId
        return start()
      }
    }
    deviceId.value = stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId.value
    localStorage.setItem('fb.deviceId', deviceId.value)

    ctx = new AudioContext({ latencyHint: 'interactive' })
    if (canPickOutput && outputId.value) await ctx.setSinkId(outputId.value).catch(() => (outputId.value = ''))
    await ctx.resume()

    source = ctx.createMediaStreamSource(stream)
    // Une seule entrée de la carte (la guitare), ou le mélange des deux, ramené en mono
    const mono = ctx.createGain()
    mono.channelCount = 1
    mono.channelCountMode = 'explicit'
    mono.channelInterpretation = 'speakers'
    if (channel.value === 'mix') source.connect(mono)
    else {
      splitter = ctx.createChannelSplitter(2)
      source.connect(splitter)
      splitter.connect(mono, Number(channel.value))
    }
    amp = createAmp(ctx, mono)
    amp.set(params.value)
    running.value = true
    latency.value = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000)
    tick()
  } catch (e) {
    error.value =
      e.name === 'NotAllowedError'
        ? "Accès au micro refusé : autorise-le dans les réglages du navigateur."
        : e.name === 'OverconstrainedError'
          ? 'Entrée introuvable, choisis-en une autre.'
          : `Erreur audio : ${e.message}`
    stop()
  }
}

function stop() {
  cancelAnimationFrame(raf)
  amp?.destroy()
  amp = null
  source?.disconnect()
  splitter?.disconnect()
  source = splitter = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  ctx?.close()
  ctx = null
  running.value = false
  inLevel.value = outLevel.value = 0
  gateOpen.value = false
}

function tick() {
  raf = requestAnimationFrame(tick)
  inLevel.value = meter(amp.inputLevel())
  outLevel.value = meter(amp.outputLevel())
  gateOpen.value = amp.gateOpen()
}

const toggle = () => (running.value ? stop() : start())

watch([deviceId, channel], () => {
  localStorage.setItem('fb.channel', channel.value)
  if (running.value) start()
})
watch(outputId, (id) => {
  localStorage.setItem('fb.amp.output', id)
  ctx?.setSinkId?.(id).catch((e) => (error.value = `Sortie indisponible : ${e.message}`))
})

onMounted(() => navigator.mediaDevices && refreshDevices())
onBeforeUnmount(stop)
</script>

<template>
  <div class="stage min-h-screen px-4 pt-5 pb-10 text-neutral-200 sm:px-8">
    <!-- Onglets -->
    <nav class="relative z-10 mx-auto mb-8 flex max-w-5xl items-center gap-4">
      <h1 class="text-lg font-black tracking-tight text-white">Fretboard <span class="text-copper-400">Live</span></h1>
      <div class="ml-auto flex rounded-xl bg-neutral-900/80 p-1 text-sm ring-1 ring-white/5 backdrop-blur">
        <a href="#" class="rounded-lg px-4 py-1.5 font-medium text-neutral-400 transition hover:text-neutral-100">Manche</a>
        <span class="rounded-lg bg-neutral-200 px-4 py-1.5 font-semibold text-neutral-950">Ampli <span class="text-[10px] font-bold text-copper-600 uppercase">test</span></span>
      </div>
    </nav>

    <main class="relative z-10 mx-auto max-w-5xl space-y-8">
      <!-- ========== Tête d'ampli ========== -->
      <section class="amp" :class="{ on: running }" :style="{ '--drive': outLevel }">
        <div class="handle" aria-hidden="true"><span /></div>
        <div class="cabinet">
          <span v-for="c in ['tl', 'tr', 'bl', 'br']" :key="c" class="corner" :class="c" aria-hidden="true" />

          <!-- Grille : les lampes s'allument derrière quand l'ampli tourne -->
          <div class="grille">
            <div class="tubes" aria-hidden="true">
              <div v-for="i in TUBES" :key="i" class="tube" :style="{ '--i': i }">
                <span class="glass" />
                <span class="filament" />
              </div>
            </div>
            <div class="slats" aria-hidden="true" />
            <div class="logo">
              <span class="script">Fretboard</span>
              <span class="model">{{ preset ? PRESET_NAMES[preset] : 'Custom' }} · 50</span>
            </div>
          </div>

          <!-- Façade -->
          <div class="faceplate">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-4">
              <!-- Entrée jack (décor) -->
              <div class="hidden flex-col items-center gap-1 lg:flex" aria-hidden="true">
                <span class="jack" />
                <span class="silk-label">Input</span>
              </div>

              <div class="grid w-full grid-cols-3 gap-x-1 gap-y-3 sm:grid-cols-5 lg:w-auto lg:flex-1 lg:grid-cols-9">
                <Knob v-for="k in KNOBS" :key="k.id" v-model="params[k.id]" :label="k.label" :default-value="PRESETS[DEFAULT_PRESET][k.id]" :size="74" />
              </div>

              <!-- Power + voyant -->
              <button class="mx-auto flex items-center gap-3 lg:mx-0 lg:flex-col lg:gap-2" :title="running ? 'Éteindre' : 'Allumer'" @click="toggle">
                <span class="jewel" />
                <span class="toggle"><span /></span>
                <span class="silk-label">Power</span>
              </button>
            </div>
          </div>
        </div>
        <div class="feet" aria-hidden="true"><span /><span /></div>
      </section>

      <div class="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <!-- ========== Pédalier : un preset par pédale ========== -->
        <section class="board">
          <div class="mb-4 flex items-baseline justify-between">
            <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Pédalier</h2>
            <span class="hidden text-[11px] text-neutral-600 sm:inline">clique une pédale pour charger le preset</span>
          </div>
          <div class="grid grid-cols-3 gap-3 sm:gap-4">
            <button
              v-for="p in PEDALS"
              :key="p.id"
              class="pedal"
              :class="{ active: preset === p.id }"
              :style="{ '--body': p.body, '--ink': p.ink }"
              @click="params = { ...PRESETS[p.id] }"
            >
              <span class="led" />
              <span class="pedal-name">{{ p.name }}</span>
              <span class="pedal-sub">{{ p.sub }}</span>
              <span class="footswitch" />
            </button>
          </div>
        </section>

        <!-- ========== Vu-mètres ========== -->
        <section class="rack">
          <div class="grid grid-cols-2 gap-3">
            <div v-for="m in [{ label: 'Input', v: inLevel }, { label: 'Output', v: outLevel }]" :key="m.label" class="vu">
              <svg viewBox="0 0 200 124" class="w-full">
                <path :d="vuArc(0, 0.72)" fill="none" stroke="#2b2520" stroke-width="2" />
                <path :d="vuArc(0.72, 1)" fill="none" stroke="#b91c1c" stroke-width="5" />
                <g v-for="t in VU_TICKS" :key="t.t + t.v">
                  <line :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" :stroke="t.red ? '#b91c1c' : '#2b2520'" stroke-width="2" />
                  <text :x="t.tx" :y="t.ty + 4" text-anchor="middle" font-size="11" font-weight="700" :fill="t.red ? '#b91c1c' : '#2b2520'">{{ t.t }}</text>
                </g>
                <text x="100" y="78" text-anchor="middle" font-size="15" font-weight="900" fill="#2b2520" letter-spacing="2">VU</text>
                <text x="100" y="94" text-anchor="middle" font-size="9" font-weight="700" fill="#57534e" letter-spacing="3">{{ m.label.toUpperCase() }}</text>
                <g class="needle" :style="{ transform: `rotate(${needle(m.v)}deg)` }">
                  <line x1="100" y1="112" x2="100" y2="20" stroke="#111" stroke-width="2" stroke-linecap="round" />
                </g>
                <circle cx="100" cy="112" r="9" fill="#1c1917" />
              </svg>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between gap-3 text-[11px] tracking-widest text-neutral-500 uppercase">
            <span class="flex items-center gap-2"><span class="led-sm" :class="{ lit: running && gateOpen }" /> Gate</span>
            <span class="lcd">{{ running && latency !== null ? `${String(latency).padStart(2, '0')} ms` : '-- ms' }}</span>
          </div>
        </section>
      </div>

      <!-- ========== Panneau arrière : branchements ========== -->
      <section class="rear">
        <span v-for="c in ['tl', 'tr', 'bl', 'br']" :key="c" class="screw" :class="c" aria-hidden="true" />
        <h2 class="mb-4 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Panneau arrière</h2>
        <div class="grid gap-4 md:grid-cols-3">
          <label class="block">
            <span class="rear-label">Input</span>
            <select v-model="deviceId" class="field">
              <option v-if="!inputs.length" value="">Allume l'ampli pour voir tes interfaces</option>
              <option v-for="d in inputs" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Entrée audio' }}</option>
            </select>
          </label>
          <label class="block">
            <span class="rear-label">Channel</span>
            <select v-model="channel" class="field">
              <option value="mix">Toutes les entrées</option>
              <option value="0">Entrée 1</option>
              <option value="1">Entrée 2</option>
            </select>
          </label>
          <label v-if="canPickOutput" class="block">
            <span class="rear-label">Output</span>
            <select v-model="outputId" class="field">
              <option value="">Sortie par défaut du système</option>
              <option v-for="d in outputs" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Sortie audio' }}</option>
            </select>
          </label>
        </div>
        <p class="mt-4 flex gap-2 text-xs leading-relaxed text-amber-200/80">
          <Icon name="volume" class="mt-0.5 size-4 shrink-0" />
          <span>Casque ou moniteurs branchés sur la Focusrite, <b>Direct Monitor</b> coupé : tu n'entends que l'ampli.</span>
        </p>
      </section>

      <p v-if="error" class="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{{ error }}</p>
      <p class="text-center text-xs text-neutral-600">Potards : glisse vers le haut ou le bas (Maj = réglage fin), molette ou flèches · double-clic = valeur Crunch</p>
    </main>
  </div>
</template>

<style scoped>
@reference "./style.css";

/* ---------- Scène : projecteur chaud au-dessus de l'ampli ---------- */
.stage {
  background:
    radial-gradient(ellipse 70% 45% at 50% 0%, color-mix(in srgb, var(--color-copper-500) 16%, transparent), transparent 70%),
    radial-gradient(ellipse 120% 60% at 50% 110%, #0d0c0b, transparent 60%),
    #1a1918;
}

/* ---------- Tête d'ampli ---------- */
.amp {
  position: relative;
  padding-top: 26px;
}
.handle {
  position: absolute;
  top: 0;
  left: 50%;
  width: 34%;
  height: 34px;
  transform: translateX(-50%);
}
.handle > span {
  position: absolute;
  inset: 0 0 6px;
  border-radius: 18px 18px 6px 6px;
  border: 9px solid #141210;
  border-bottom: 0;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.06),
    0 -1px 0 rgba(255, 255, 255, 0.05);
}
.handle::before,
.handle::after {
  content: '';
  position: absolute;
  bottom: -4px;
  width: 30px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(#cfd2d6, #6b7078);
}
.handle::before {
  left: -8px;
}
.handle::after {
  right: -8px;
}
.cabinet {
  position: relative;
  border-radius: 26px;
  padding: 16px;
  /* Tolex grainé + liseré (piping) à la couleur d'accent */
  background:
    radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.05) 1px, transparent 1.4px) 0 0 / 4px 4px,
    radial-gradient(circle at 3px 3px, rgba(0, 0, 0, 0.5) 1px, transparent 1.4px) 0 0 / 5px 5px,
    linear-gradient(180deg, #1b1917, #0f0e0d);
  box-shadow:
    inset 0 0 0 2px #070605,
    inset 0 0 0 5px color-mix(in srgb, var(--color-copper-400) 55%, transparent),
    inset 0 0 0 7px #070605,
    0 40px 60px -20px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(255, 255, 255, 0.04);
}
@media (min-width: 640px) {
  .cabinet {
    padding: 22px;
  }
}
/* Coins métalliques */
.corner {
  position: absolute;
  width: 34px;
  height: 34px;
  background: radial-gradient(circle at 30% 30%, #f4f4f5, #9ca3af 45%, #4b5563);
  z-index: 2;
}
.corner.tl {
  top: -3px;
  left: -3px;
  border-radius: 26px 4px 18px 4px;
}
.corner.tr {
  top: -3px;
  right: -3px;
  border-radius: 4px 26px 4px 18px;
}
.corner.bl {
  bottom: -3px;
  left: -3px;
  border-radius: 4px 18px 4px 26px;
}
.corner.br {
  bottom: -3px;
  right: -3px;
  border-radius: 18px 4px 26px 4px;
}
.feet {
  display: flex;
  justify-content: space-between;
  padding: 0 12%;
}
.feet span {
  width: 60px;
  height: 8px;
  border-radius: 0 0 6px 6px;
  background: #0a0908;
}

/* Grille et lampes */
.grille {
  position: relative;
  height: 120px;
  overflow: hidden;
  border-radius: 12px;
  background: #050404;
  box-shadow: inset 0 6px 18px rgba(0, 0, 0, 0.9);
}
@media (min-width: 640px) {
  .grille {
    height: 150px;
  }
}
.tubes {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 9%;
  padding-bottom: 6px;
}
.amp.on .tubes {
  background: radial-gradient(ellipse 65% 90% at 50% 100%, rgba(255, 120, 40, calc(0.22 + var(--drive) * 0.35)), transparent 70%);
  transition: background 0.1s;
}
.tube {
  position: relative;
  width: 42px;
  height: 78%;
}
.tube .glass {
  position: absolute;
  inset: 0;
  border-radius: 20px 20px 6px 6px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.14) 30%, rgba(255, 255, 255, 0.02) 60%, rgba(255, 255, 255, 0.08));
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.tube .filament {
  position: absolute;
  left: 30%;
  right: 30%;
  bottom: 18%;
  height: 46%;
  border-radius: 4px;
  background: linear-gradient(#3a2a1c, #1a120b);
  transition:
    background 0.6s,
    box-shadow 0.6s;
}
.amp.on .tube .filament {
  background: linear-gradient(#ffd8a8, #ff8a3d 40%, #c2410c);
  box-shadow:
    0 0 calc(14px + var(--drive) * 26px) calc(6px + var(--drive) * 10px) rgba(255, 120, 40, 0.55),
    0 0 60px 20px rgba(255, 110, 30, 0.18);
  animation: flicker 2.6s infinite steps(1);
  animation-delay: calc(var(--i) * -0.7s);
}
@keyframes flicker {
  0%,
  100% {
    opacity: 1;
  }
  47% {
    opacity: 0.88;
  }
  49% {
    opacity: 1;
  }
  83% {
    opacity: 0.93;
  }
}
.slats {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(180deg, transparent 0 7px, rgba(20, 18, 16, 0.92) 7px 13px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.5), transparent 20%, transparent 80%, rgba(0, 0, 0, 0.5));
}
.logo {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.logo .script {
  font-family: 'Yellowtail', cursive;
  font-size: 54px;
  line-height: 1;
  color: #f5f1ea;
  text-shadow:
    0 2px 0 #000,
    0 0 1px #000,
    0 6px 14px rgba(0, 0, 0, 0.8);
  transform: rotate(-4deg);
}
@media (min-width: 640px) {
  .logo .script {
    font-size: 68px;
  }
}
.logo .model {
  margin-top: 4px;
  padding: 1px 10px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: #1a1410;
  background: linear-gradient(#f2e3c4, #c9a76a);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
}

/* Façade en métal brossé, teintée par l'accent de la guitare */
.faceplate {
  --silk: #1c1612;
  margin-top: 16px;
  padding: 18px 20px 14px;
  border-radius: 10px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.07) 0 1px, transparent 1px 3px),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-copper-300) 55%, #f6e2b8) 0%,
      color-mix(in srgb, var(--color-copper-400) 65%, #c4924a) 45%,
      color-mix(in srgb, var(--color-copper-600) 70%, #7a5222) 100%
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    inset 0 -2px 0 rgba(0, 0, 0, 0.25),
    0 3px 10px rgba(0, 0, 0, 0.6);
}
.silk-label {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--silk);
}
.jack {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: radial-gradient(circle, #000 0 28%, #6b7078 30% 48%, #e5e7eb 52% 62%, #4b5563 66%);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}
.toggle {
  position: relative;
  width: 22px;
  height: 34px;
  border-radius: 6px;
  background: #0c0a09;
  box-shadow: inset 0 0 0 2px #3f3a36;
}
.toggle > span {
  position: absolute;
  left: 4px;
  right: 4px;
  top: 4px;
  height: 14px;
  border-radius: 3px;
  background: linear-gradient(#f4f4f5, #9ca3af);
  transition: top 0.15s;
}
.amp.on .toggle > span {
  top: 16px;
}
.jewel {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 3px solid #a8a29e;
  background: radial-gradient(circle at 35% 30%, #7f1d1d, #2a0707);
  transition: box-shadow 0.3s;
}
.amp.on .jewel {
  background: radial-gradient(circle at 35% 30%, #fee2e2, #ef4444 45%, #7f1d1d);
  box-shadow: 0 0 18px 5px rgba(239, 68, 68, 0.6);
}

/* ---------- Pédalier ---------- */
.board {
  padding: 20px;
  border-radius: 18px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.35) 0 2px, transparent 2px 14px),
    linear-gradient(#2a2826, #1c1b1a);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 20px 40px -20px rgba(0, 0, 0, 0.8);
}
.pedal {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 14px 8px 14px;
  border-radius: 12px;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.28), transparent 40%, rgba(0, 0, 0, 0.25)),
    var(--body);
  color: var(--ink);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -3px 0 rgba(0, 0, 0, 0.25),
    0 10px 18px -6px rgba(0, 0, 0, 0.8);
  transition:
    transform 0.1s,
    box-shadow 0.1s;
}
.pedal:hover {
  transform: translateY(-2px);
}
.pedal:active {
  transform: translateY(1px);
}
.pedal .led {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #3b0a0a;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
}
.pedal.active .led {
  background: #ff3b3b;
  box-shadow:
    0 0 10px 3px rgba(255, 59, 59, 0.7),
    inset 0 1px 1px rgba(255, 255, 255, 0.6);
}
.pedal-name {
  margin-top: 8px;
  font-size: 18px;
  font-weight: 900;
  font-style: italic;
  letter-spacing: -0.02em;
  line-height: 1;
}
.pedal-sub {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  opacity: 0.7;
}
.footswitch {
  margin-top: 12px;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 30%, #fafafa, #a1a1aa 45%, #3f3f46);
  box-shadow:
    0 0 0 4px rgba(0, 0, 0, 0.35),
    0 4px 6px rgba(0, 0, 0, 0.5);
  transition: transform 0.1s;
}
.pedal.active .footswitch {
  transform: scale(0.92);
}

/* ---------- Vu-mètres ---------- */
.rack {
  padding: 16px;
  border-radius: 18px;
  background: linear-gradient(#22201e, #161514);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 20px 40px -20px rgba(0, 0, 0, 0.8);
}
.vu {
  overflow: hidden;
  border-radius: 10px;
  padding: 6px 6px 0;
  background: radial-gradient(ellipse at 50% 120%, #fff1c9, #f2dca2 55%, #d9bb76);
  box-shadow:
    inset 0 0 0 3px #0c0a09,
    inset 0 8px 18px rgba(0, 0, 0, 0.35);
}
.needle {
  transform-origin: 100px 112px;
  transition: transform 0.09s linear;
}
.led-sm {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #14301f;
}
.led-sm.lit {
  background: #4ade80;
  box-shadow: 0 0 8px 2px rgba(74, 222, 128, 0.6);
}
.lcd {
  padding: 2px 10px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #fbbf77;
  background: #120d08;
  box-shadow: inset 0 0 0 1px #3a2a1a;
  text-shadow: 0 0 6px rgba(251, 191, 119, 0.6);
}

/* ---------- Panneau arrière ---------- */
.rear {
  position: relative;
  padding: 22px 26px;
  border-radius: 14px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px),
    linear-gradient(#2b2a29, #1e1d1c);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 0 0 1px rgba(0, 0, 0, 0.5);
}
.screw {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background:
    linear-gradient(45deg, transparent 44%, #1c1917 44% 56%, transparent 56%),
    radial-gradient(circle at 35% 30%, #e5e7eb, #6b7280);
}
.screw.tl {
  top: 9px;
  left: 9px;
}
.screw.tr {
  top: 9px;
  right: 9px;
}
.screw.bl {
  bottom: 9px;
  left: 9px;
}
.screw.br {
  bottom: 9px;
  right: 9px;
}
.rear-label {
  display: block;
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.3em;
  color: #a8a29e;
}
.field {
  @apply w-full rounded-lg bg-neutral-950/70 px-3 py-2 text-sm text-neutral-200 ring-1 ring-white/10 outline-none focus:ring-copper-400/60;
}
</style>
