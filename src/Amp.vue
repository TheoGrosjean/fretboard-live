<script setup>
// Onglet « Ampli » (phase de test) : la guitare passe dans un mini simulateur d'ampli, en direct
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Knob from './components/amp/Knob.vue'
import PowerSwitch from './components/amp/PowerSwitch.vue'
import Pedal from './components/amp/Pedal.vue'
import Icon from './components/Icon.vue'
import { DEFAULT_PRESET, PRESETS, createAmp } from './lib/ampChain'
import { CABINETS, DEFAULT_CABINET, DEFAULT_MIC, cabinetImpulse, loadImpulse, responseCurve } from './lib/cabinets'
import { DEFAULT_BODY_FINISH, applyAccent } from './lib/noteStyles'
import { ampOn, soloPlayer } from './lib/ampStatus'

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
// Pédales du pédalier (une par preset) ; les mini-potards montrent les réglages du preset
const PEDALS = [
  { id: 'clean', name: 'Clean', sub: 'Sparkle', type: 'script', body: '#d9d0bd', ink: '#2b2520', knobs: [['Level', 'master'], ['Tone', 'treble'], ['Verb', 'reverb']] },
  { id: 'crunch', name: 'Crunch', sub: 'Plexi drive', type: 'block', body: 'color-mix(in srgb, var(--color-copper-500) 62%, #3a2f27)', ink: '#f5ead8', knobs: [['Gain', 'gain'], ['Tone', 'treble'], ['Level', 'master']] },
  { id: 'lead', name: 'Lead', sub: 'Hot rod', type: 'block', body: '#6e1a1a', ink: '#f5e1d8', knobs: [['Drive', 'gain'], ['Mid', 'mid'], ['Delay', 'delay']] },
].map((p) => ({ ...p, knobs: p.knobs.map(([label, id]) => ({ label, value: PRESETS[p.id][id] })) }))
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
watch(running, (on) => (ampOn.value = on))
const error = ref('')
const latency = ref(null)
const inLevel = ref(0)
const outLevel = ref(0)
const gateOpen = ref(false)

// ---------- Baffle : modèle synthétique (+ micro) ou réponse impulsionnelle chargée (.wav) ----------
const cabinet = ref(stored('fb.amp.cab', DEFAULT_CABINET)) // id de CABINETS, ou 'custom'
const mic = ref({ ...DEFAULT_MIC, ...stored('fb.amp.mic', {}) })
const customIr = ref(stored('fb.amp.customIr', null)) // { name, data (data URL) }
const cabError = ref('')
watch(cabinet, (c) => localStorage.setItem('fb.amp.cab', JSON.stringify(c)))
watch(mic, (m) => localStorage.setItem('fb.amp.mic', JSON.stringify(m)), { deep: true })

/** Réponse impulsionnelle du baffle choisi, pour le contexte audio de l'ampli. */
async function cabinetBuffer() {
  if (cabinet.value === 'custom' && customIr.value) {
    const data = await (await fetch(customIr.value.data)).arrayBuffer()
    return loadImpulse(ctx, data)
  }
  return cabinetImpulse(ctx, cabinet.value === 'custom' ? DEFAULT_CABINET : cabinet.value, mic.value)
}
async function applyCabinet() {
  if (!amp || !ctx) return
  try {
    amp.setCabinet(await cabinetBuffer())
    cabError.value = ''
  } catch (e) {
    cabError.value = `Baffle illisible : ${e.message}`
  }
}
let micTimer = 0
watch(cabinet, applyCabinet)
watch(mic, () => (clearTimeout(micTimer), (micTimer = setTimeout(applyCabinet, 80))), { deep: true })

// Mini-courbe de réponse du baffle (60 Hz → 12 kHz)
const curvePath = computed(() => {
  if (cabinet.value === 'custom') return ''
  const pts = responseCurve(cabinet.value, mic.value, 60)
  const y = (db) => Math.min(50, Math.max(2, 18 - db * 0.85))
  return pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 160).toFixed(1)},${y(p.db).toFixed(1)}`).join(' ')
})

/** Fichier .wav de réponse impulsionnelle choisi par l'utilisateur (gardé dans le navigateur s'il est petit). */
async function onIrFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  customIr.value = { name: file.name.replace(/\.wav$/i, ''), data }
  try {
    localStorage.setItem('fb.amp.customIr', JSON.stringify(customIr.value))
  } catch {
    cabError.value = 'Fichier trop gros pour être mémorisé : il faudra le recharger la prochaine fois.'
  }
  if (cabinet.value === 'custom') applyCabinet()
  else cabinet.value = 'custom'
}

let ctx = null
let stream = null
let amp = null
let source = null
let splitter = null
let playerGains = [] // gains des entrées 1 et 2 dans le mélange (jam : couper le joueur qui attend)
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
    const stereo = stream.getAudioTracks()[0]?.getSettings().channelCount !== 1
    if (channel.value === 'mix' && stereo) {
      // Mélange des deux entrées, chacune avec son gain : la jam peut couper le joueur qui attend son tour
      splitter = ctx.createChannelSplitter(2)
      source.connect(splitter)
      playerGains = [0, 1].map((i) => {
        const g = ctx.createGain()
        g.gain.value = playerGain(i)
        splitter.connect(g, i).connect(mono)
        return g
      })
    } else if (channel.value === 'mix') source.connect(mono)
    else {
      splitter = ctx.createChannelSplitter(2)
      source.connect(splitter)
      splitter.connect(mono, Number(channel.value))
    }
    amp = await createAmp(ctx, mono)
    amp.set(params.value)
    await applyCabinet()
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
  playerGains.forEach((g) => g.disconnect())
  playerGains = []
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

// Jam « un seul joueur à la fois » : le joueur qui reçoit la main entre tout de suite,
// celui qui la rend s'éteint en fondu (sa dernière note sonne encore un peu)
const MIX_GAIN = 0.5 // même niveau que le mélange stéréo → mono
const FADE_OUT = 0.4 // constante de temps (s) : ~1,5 s pour s'éteindre
const playerGain = (i) => (soloPlayer.value === null || soloPlayer.value === i ? MIX_GAIN : 0)
watch(soloPlayer, () => {
  if (!ctx) return
  const t = ctx.currentTime
  playerGains.forEach((g, i) => {
    const target = playerGain(i)
    g.gain.cancelScheduledValues(t)
    g.gain.setValueAtTime(g.gain.value, t)
    if (target > 0) g.gain.linearRampToValueAtTime(target, t + 0.005) // 5 ms : juste de quoi éviter un clic
    else g.gain.setTargetAtTime(0, t, FADE_OUT)
  })
})

watch([deviceId, channel], () => {
  localStorage.setItem('fb.channel', channel.value)
  if (running.value) start()
})
watch(outputId, (id) => {
  localStorage.setItem('fb.amp.output', id)
  ctx?.setSinkId?.(id).catch((e) => (error.value = `Sortie indisponible : ${e.message}`))
})

// Sur ordinateur, toute la page tient dans l'écran sans défilement : on la réduit juste ce qu'il faut
const stage = ref(null)
const mainEl = ref(null)
const TOPBAR_HEIGHT = 56 // barre du haut (TopBar.vue, h-14)
function fitToScreen() {
  const el = stage.value
  if (!el) return
  el.style.zoom = ''
  el.style.minHeight = ''
  if (innerWidth < 1024) return
  const available = innerHeight - TOPBAR_HEIGHT
  const natural = mainEl.value.getBoundingClientRect().bottom - el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingBottom)
  const scale = Math.max(0.7, Math.min(1, available / natural))
  if (scale === 1) return
  el.style.zoom = String(scale)
  el.style.minHeight = `${available / scale}px` // le fond couvre toujours tout l'écran
}

onMounted(() => {
  navigator.mediaDevices && refreshDevices()
  fitToScreen()
  addEventListener('resize', fitToScreen)
  document.fonts?.ready.then(fitToScreen)
})
// Retour sur l'onglet : la page était en mémoire (l'ampli a continué de jouer), on réajuste l'échelle
onActivated(fitToScreen)
onBeforeUnmount(() => {
  stop()
  removeEventListener('resize', fitToScreen)
})
</script>

<template>
  <div ref="stage" class="stage min-h-[calc(100vh-3.5rem)] px-4 pt-6 pb-6 text-neutral-200 sm:px-8">

    <main ref="mainEl" class="relative z-10 mx-auto max-w-5xl space-y-5">
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
                <PowerSwitch :on="running" />
                <span class="silk-label">Power</span>
              </button>
            </div>
          </div>
        </div>
        <div class="feet" aria-hidden="true"><span /><span /></div>
      </section>

      <!-- ========== Baffle ========== -->
      <section class="cab-strip">
        <div class="flex w-full shrink-0 items-center justify-between gap-4 sm:w-auto sm:flex-col sm:items-start sm:justify-center">
          <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Baffle</h2>
          <svg v-if="curvePath" viewBox="0 0 160 52" class="h-[52px] w-40 sm:mt-2" aria-label="Réponse en fréquence du baffle">
            <line x1="0" x2="160" y1="18" y2="18" stroke="#ffffff14" />
            <path :d="curvePath" fill="none" stroke="var(--color-copper-400)" stroke-width="1.6" />
          </svg>
        </div>

        <div class="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex-1 sm:grid-cols-4">
          <button v-for="c in CABINETS" :key="c.id" class="cab-card" :class="{ on: cabinet === c.id }" @click="cabinet = c.id">
            <!-- Façade du baffle : un rond par haut-parleur -->
            <svg viewBox="0 0 64 44" class="h-8 w-12 shrink-0" aria-hidden="true">
              <rect x="1" y="1" width="62" height="42" rx="4" fill="#0d0c0b" stroke="#2a2725" />
              <rect x="5" y="5" width="54" height="34" rx="2" class="cloth" />
              <circle
                v-for="(p, i) in { '1x12': [[32, 22, 12]], '2x12': [[19, 22, 10], [45, 22, 10]], '4x12': [[19, 14, 7], [45, 14, 7], [19, 30, 7], [45, 30, 7]] }[c.id]"
                :key="i"
                :cx="p[0]"
                :cy="p[1]"
                :r="p[2]"
                fill="#00000055"
                stroke="#00000088"
              />
            </svg>
            <span class="min-w-0 text-center">
              <span class="block truncate text-xs font-bold text-neutral-100">{{ c.name }}</span>
              <span class="block truncate text-[10px] text-neutral-500">{{ c.sub }}</span>
            </span>
          </button>
          <!-- Réponse impulsionnelle chargée -->
          <label class="cab-card cursor-pointer" :class="{ on: cabinet === 'custom' && customIr }" @click="customIr && cabinet !== 'custom' && ((cabinet = 'custom'), $event.preventDefault())">
            <input type="file" accept=".wav,audio/wav" class="sr-only" @change="onIrFile" />
            <span class="flex h-8 w-12 shrink-0 items-center justify-center rounded border border-dashed border-white/20 text-lg text-neutral-500">+</span>
            <span class="min-w-0 text-center">
              <span class="block truncate text-xs font-bold text-neutral-100">{{ customIr ? customIr.name : 'Fichier .wav' }}</span>
              <span class="block truncate text-[10px] text-neutral-500">{{ customIr ? (cabinet === 'custom' ? 'clique pour en changer' : 'ta réponse impulsionnelle') : 'réponse impulsionnelle' }}</span>
            </span>
          </label>
        </div>

        <!-- Micro devant le haut-parleur -->
        <div class="flex w-full shrink-0 flex-col justify-center gap-2 sm:w-56" :class="{ 'pointer-events-none opacity-40': cabinet === 'custom' }">
          <label class="mic-row">
            <span>Centre</span>
            <input v-model.number="mic.position" type="range" min="0" max="1" step="0.01" aria-label="Position du micro" />
            <span>Bord</span>
          </label>
          <label class="mic-row">
            <span>Près</span>
            <input v-model.number="mic.distance" type="range" min="0" max="1" step="0.01" aria-label="Distance du micro" />
            <span>Loin</span>
          </label>
        </div>
        <p v-if="cabError" class="w-full text-xs text-amber-300">{{ cabError }}</p>
      </section>

      <div class="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <!-- ========== Pédalier : un preset par pédale ========== -->
        <section class="board">
          <div class="mb-4 flex items-baseline justify-between">
            <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Pédalier</h2>
            <span class="hidden text-[11px] text-neutral-600 sm:inline">clique une pédale pour charger le preset</span>
          </div>
          <div class="grid grid-cols-3 gap-3 sm:gap-4">
            <button v-for="p in PEDALS" :key="p.id" class="pedal" :title="`Charger le preset ${p.name}`" @click="params = { ...PRESETS[p.id] }">
              <Pedal :name="p.name" :sub="p.sub" :type="p.type" :body="p.body" :ink="p.ink" :knobs="p.knobs" :active="preset === p.id" />
            </button>
          </div>
        </section>

        <!-- ========== Vu-mètres ========== -->
        <section class="rack flex flex-col justify-center">
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

          <!-- Branchements (ancien panneau arrière), sous le gate -->
          <div class="mt-4 border-t border-white/5 pt-3">
            <div class="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-widest text-neutral-500 uppercase">
              Branchements
              <span class="text-amber-200/70" title="Casque ou moniteurs branchés sur la Focusrite, Direct Monitor coupé : tu n'entends que l'ampli.">
                <Icon name="volume" class="size-3.5" />
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-2">
              <label class="col-span-2 block">
                <span class="rear-label">Input</span>
                <select v-model="deviceId" class="field">
                  <option v-if="!inputs.length" value="">Allume l'ampli pour voir tes interfaces</option>
                  <option v-for="d in inputs" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Entrée audio' }}</option>
                </select>
              </label>
              <label class="block" :class="{ 'col-span-2': !canPickOutput }">
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
                  <option value="">Sortie par défaut</option>
                  <option v-for="d in outputs" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Sortie audio' }}</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      </div>

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
    /* spot sur le mur derrière la tête : fait ressortir son ombre portée */
    radial-gradient(ellipse 62% 420px at 50% 290px, color-mix(in srgb, var(--color-copper-300) 18%, #3b3531), transparent 78%),
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
    /* volume : arête du haut qui accroche la lumière, bas dans l'ombre */
    inset 0 9px 6px -6px rgba(255, 255, 255, 0.07),
    inset 0 -14px 18px -8px rgba(0, 0, 0, 0.6),
    /* profondeur : ombres en couches, de la plus serrée à la plus diffuse */
    0 0 0 1px rgba(255, 255, 255, 0.05),
    0 2px 3px rgba(0, 0, 0, 0.6),
    0 10px 18px -4px rgba(0, 0, 0, 0.65),
    0 30px 50px -10px rgba(0, 0, 0, 0.75),
    0 60px 100px -20px rgba(0, 0, 0, 0.7),
    0 0 120px 10px rgba(0, 0, 0, 0.45);
}
/* Ombre au sol sous la tête */
.cabinet::after {
  content: '';
  position: absolute;
  left: 6%;
  right: 6%;
  bottom: -34px;
  height: 40px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0, 0, 0, 0.75), transparent);
  filter: blur(6px);
  z-index: -1;
  pointer-events: none;
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

/* Façade en métal brossé foncé, à peine teintée par l'accent de la guitare */
.faceplate {
  --silk: #ece3d0;
  margin-top: 16px;
  padding: 18px 20px 14px;
  border-radius: 10px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0 1px, transparent 1px 3px),
    radial-gradient(ellipse 60% 120% at 30% 0%, rgba(255, 255, 255, 0.07), transparent 70%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-copper-500) 12%, #35312d) 0%,
      color-mix(in srgb, var(--color-copper-500) 9%, #221f1c) 55%,
      color-mix(in srgb, var(--color-copper-500) 7%, #171513) 100%
    );
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--color-copper-400) 45%, transparent),
    inset 0 0 0 3px rgba(0, 0, 0, 0.55),
    inset 0 4px 0 -1px rgba(255, 255, 255, 0.08),
    inset 0 -6px 10px -4px rgba(0, 0, 0, 0.6),
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
.jewel {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  /* voyant serti dans une bague chromée, couleur d'accent quand l'ampli est allumé */
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--color-copper-500) 35%, #1a1412), #060404 75%);
  box-shadow:
    0 0 0 2px #0b0b0b,
    0 0 0 3.5px #9ca3af,
    0 0 0 4.5px #1f2937,
    0 3px 6px 3px rgba(0, 0, 0, 0.5);
  transition:
    background 0.3s,
    box-shadow 0.3s;
}
.amp.on .jewel {
  background: radial-gradient(circle at 35% 30%, #fff8ec, var(--color-copper-300) 30%, var(--color-copper-500) 60%, color-mix(in srgb, var(--color-copper-600) 60%, #000));
  box-shadow:
    0 0 0 2px #0b0b0b,
    0 0 0 3.5px #9ca3af,
    0 0 0 4.5px #1f2937,
    0 0 16px 5px color-mix(in srgb, var(--color-copper-500) 55%, transparent);
}

/* ---------- Pédalier ---------- */
/* Pédalier façon Pedaltrain : cadre alu anodisé, rails recouverts de velcro séparés par des fentes */
.board {
  position: relative;
  padding: 20px;
  border-radius: 18px;
  background:
    /* grain du velcro */
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='v'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.3' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 -0.35'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23v)' opacity='0.16'/%3E%3C/svg%3E"),
    /* rails : arête du haut éclairée, bas dans l'ombre, puis fente noire */
    repeating-linear-gradient(
      180deg,
      #2c2a28 0 1px,
      #1d1c1b 1px 6px,
      #171615 6px 40px,
      #0f0e0d 40px 43px,
      #020202 43px 46px,
      #050505 46px 52px
    )
    0 46px / 100% 100%,
    #1a1918;
  box-shadow:
    /* cadre */
    inset 0 0 0 1px rgba(255, 255, 255, 0.07),
    inset 0 0 0 7px #121110,
    inset 0 0 0 8px rgba(255, 255, 255, 0.04),
    inset 0 0 24px 4px rgba(0, 0, 0, 0.75),
    0 20px 40px -20px rgba(0, 0, 0, 0.8);
}
.pedal {
  display: block;
  padding: 0 6px;
  border-radius: 12px;
  outline: none;
  transition: transform 0.12s;
}
.pedal:hover {
  transform: translateY(-2px);
}
.pedal:active {
  transform: translateY(1px);
}
.pedal:focus-visible {
  box-shadow: 0 0 0 2px var(--color-copper-400);
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

/* ---------- Baffle ---------- */
.cab-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 16px 20px;
  padding: 14px 20px;
  border-radius: 18px;
  background:
    radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.04) 1px, transparent 1.4px) 0 0 / 4px 4px,
    linear-gradient(#1d1b19, #141312);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04),
    0 20px 40px -20px rgba(0, 0, 0, 0.8);
}
.cab-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border-radius: 12px;
  padding: 8px 6px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  transition:
    background 0.15s,
    box-shadow 0.15s;
}
.cab-card:hover {
  background: rgba(255, 255, 255, 0.06);
}
.cab-card.on {
  background: color-mix(in srgb, var(--color-copper-500) 12%, transparent);
  box-shadow:
    inset 0 0 0 2px var(--color-copper-400),
    0 8px 24px -10px color-mix(in srgb, var(--color-copper-500) 60%, transparent);
}
/* Toile de baffle tressée */
.cab-card .cloth {
  fill: #3a3128;
}
.cab-card.on .cloth {
  fill: color-mix(in srgb, var(--color-copper-500) 30%, #3a3128);
}
.mic-row {
  display: grid;
  grid-template-columns: 44px 1fr 36px;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #a8a29e;
}
.mic-row span:last-child {
  text-align: right;
}
.mic-row input {
  accent-color: var(--color-copper-400);
}

/* ---------- Branchements ---------- */
.rear-label {
  display: block;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.3em;
  color: #a8a29e;
}
.field {
  @apply w-full rounded-lg bg-neutral-950/70 px-3 py-1.5 text-sm text-neutral-200 ring-1 ring-white/10 outline-none focus:ring-copper-400/60;
}
</style>
