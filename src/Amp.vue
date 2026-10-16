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
  <div class="min-h-screen bg-anthracite px-4 py-5 text-neutral-200 sm:px-8">
    <!-- Onglets -->
    <nav class="mx-auto mb-6 flex max-w-5xl items-center gap-4">
      <h1 class="text-lg font-black tracking-tight text-white">Fretboard <span class="text-copper-400">Live</span></h1>
      <div class="ml-auto flex rounded-xl bg-neutral-900 p-1 text-sm ring-1 ring-white/5">
        <a href="#" class="rounded-lg px-4 py-1.5 font-medium text-neutral-400 transition hover:text-neutral-100">Manche</a>
        <span class="rounded-lg bg-neutral-200 px-4 py-1.5 font-semibold text-neutral-950">Ampli <span class="text-[10px] font-bold text-copper-600 uppercase">test</span></span>
      </div>
    </nav>

    <main class="mx-auto max-w-5xl space-y-5">
      <!-- Tête d'ampli -->
      <section class="tolex rounded-3xl p-3 shadow-2xl shadow-black/60 sm:p-4">
        <div class="faceplate rounded-2xl px-5 py-6 sm:px-8">
          <div class="mb-6 flex items-center justify-between gap-4">
            <div>
              <div class="text-2xl font-black tracking-tight text-white italic">Fretboard<span class="text-copper-400">Live</span></div>
              <div class="text-[10px] font-bold tracking-[0.45em] text-neutral-500 uppercase">{{ preset ? PRESET_NAMES[preset] : 'Custom' }} 50 · tube sim</div>
            </div>
            <!-- Interrupteur + voyant -->
            <button class="flex items-center gap-3" :title="running ? 'Éteindre' : 'Allumer'" @click="toggle">
              <span class="text-[11px] font-bold tracking-[0.25em] text-neutral-400 uppercase">Power</span>
              <span class="switch" :class="{ on: running }"><span /></span>
              <span class="jewel" :class="{ on: running }" />
            </button>
          </div>

          <div class="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-5 lg:grid-cols-9">
            <Knob v-for="k in KNOBS" :key="k.id" v-model="params[k.id]" :label="k.label" :default-value="PRESETS[DEFAULT_PRESET][k.id]" />
          </div>
        </div>
      </section>

      <div class="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <!-- Presets + niveaux -->
        <section class="space-y-5 rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5">
          <div>
            <h2 class="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Presets</h2>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="(name, id) in PRESET_NAMES"
                :key="id"
                class="rounded-xl py-2.5 font-bold transition"
                :class="preset === id ? 'bg-copper-500 text-neutral-950' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'"
                @click="params = { ...PRESETS[id] }"
              >
                {{ name }}
              </button>
            </div>
          </div>

          <div class="space-y-3">
            <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Niveaux</h2>
            <div v-for="m in [{ label: 'Entrée', v: inLevel }, { label: 'Sortie', v: outLevel }]" :key="m.label" class="flex items-center gap-3 text-xs text-neutral-500">
              <span class="w-12">{{ m.label }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
                <div class="h-full rounded-full bg-linear-to-r from-copper-600 via-copper-400 to-rose-500" :style="{ width: m.v * 100 + '%' }" />
              </div>
            </div>
            <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
              <span class="flex items-center gap-1.5"><span class="size-2 rounded-full" :class="running && gateOpen ? 'bg-emerald-400' : 'bg-neutral-700'" /> Gate {{ running ? (gateOpen ? 'ouvert' : 'fermé') : '—' }}</span>
              <span v-if="running && latency !== null">Latence du navigateur ≈ {{ latency }} ms</span>
            </div>
          </div>
        </section>

        <!-- Branchements -->
        <section class="space-y-3 rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5">
          <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Branchements</h2>
          <label class="block">
            <span class="mb-1 block text-xs text-neutral-500">Entrée</span>
            <select v-model="deviceId" class="field">
              <option v-if="!inputs.length" value="">Allume l'ampli pour voir tes interfaces</option>
              <option v-for="d in inputs" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Entrée audio' }}</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-neutral-500">Canal</span>
            <select v-model="channel" class="field">
              <option value="mix">Toutes les entrées</option>
              <option value="0">Entrée 1</option>
              <option value="1">Entrée 2</option>
            </select>
          </label>
          <label v-if="canPickOutput" class="block">
            <span class="mb-1 block text-xs text-neutral-500">Sortie</span>
            <select v-model="outputId" class="field">
              <option value="">Sortie par défaut du système</option>
              <option v-for="d in outputs" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Sortie audio' }}</option>
            </select>
          </label>
          <p class="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
            <Icon name="volume" class="mt-0.5 size-4 shrink-0" />
            <span>Joue au casque ou sur des moniteurs branchés à la Focusrite, et coupe le <b>Direct Monitor</b> de la carte pour n'entendre que le son de l'ampli.</span>
          </p>
        </section>
      </div>

      <p v-if="error" class="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{{ error }}</p>
      <p class="pb-4 text-center text-xs text-neutral-600">Potards : glisse vers le haut ou le bas (Maj pour un réglage fin), molette, flèches · double-clic = valeur du preset Crunch</p>
    </main>
  </div>
</template>

<style scoped>
@reference "./style.css";

.field {
  @apply w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 ring-1 ring-white/5 outline-none focus:ring-copper-400/60;
}
/* Tolex noir grainé autour de la façade */
.tolex {
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.025) 0 2px, transparent 2px 5px),
    repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.35) 0 2px, transparent 2px 5px),
    #141312;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 0 1px rgba(0, 0, 0, 0.6);
}
/* Façade en métal brossé sombre, liseré à la couleur d'accent */
.faceplate {
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.018) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #2a2725, #1b1918);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--color-copper-400) 35%, transparent),
    inset 0 2px 0 rgba(255, 255, 255, 0.05);
}
/* Interrupteur à bascule */
.switch {
  @apply relative block h-8 w-5 rounded-md bg-neutral-950 ring-1 ring-white/10;
}
.switch > span {
  @apply absolute inset-x-0.5 top-0.5 h-3.5 rounded-sm bg-neutral-400 transition-all;
}
.switch.on > span {
  @apply top-auto bottom-0.5 bg-neutral-200;
}
/* Voyant façon pierre rouge */
.jewel {
  @apply block size-6 rounded-full ring-2 ring-neutral-600;
  background: radial-gradient(circle at 35% 30%, #7f1d1d, #3b0a0a);
}
.jewel.on {
  background: radial-gradient(circle at 35% 30%, #fecaca, #ef4444 45%, #7f1d1d);
  box-shadow: 0 0 18px 4px rgba(239, 68, 68, 0.55);
}
</style>
