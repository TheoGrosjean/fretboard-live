<script setup>
// Module Métronome : l'interface. Le moteur (son, horloge, réglages) est dans composables/useMetronome.js ;
// une page peut fournir le sien (prop metro) pour piloter le tempo, sinon le module crée le sien.
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import { MAX_BPM, MIN_BPM, SIGNATURES, SUBDIVISIONS, useMetronome, volumeDb } from '../composables/useMetronome'
import Icon from './Icon.vue'

const props = defineProps({
  metro: { type: Object, default: null }, // moteur fourni par la page (voir useMetronome)
  shortcuts: { type: Boolean, default: true }, // false : clavier laissé au mode jeu (ou géré par la page)
})
const m = props.metro ?? useMetronome()
const { bpm, beats, accent, volume, subdiv, playing, current, tempoName, setBpm, toggle, tap } = m
const MIN = MIN_BPM
const MAX = MAX_BPM

// ---------- Clavier : Espace lance/arrête, ↑ ↓ ±1 BPM (±5 avec Maj), ← → changent de rythme ----------
function onKey(e) {
  if (!props.shortcuts || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return
  const step = e.shiftKey ? 5 : 1
  if (e.code === 'Space') toggle()
  else if (e.key === 'ArrowUp') setBpm(bpm.value + step)
  else if (e.key === 'ArrowDown') setBpm(bpm.value - step)
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') m.stepSubdiv(e.key === 'ArrowRight' ? 1 : -1)
  else return
  e.preventDefault() // pas de défilement, ni de clic sur le bouton qui a le focus
}
const listen = (on) => window[on ? 'addEventListener' : 'removeEventListener']('keydown', onKey)
onMounted(() => listen(true))
onActivated(() => listen(true))
// La page est gardée en mémoire : en changeant d'onglet, on coupe le son et le clavier
onDeactivated(() => {
  m.stop()
  listen(false)
})
onBeforeUnmount(() => {
  listen(false)
  if (!props.metro) m.dispose()
})
</script>

<template>
  <section class="metro flex min-h-0 flex-col rounded-2xl bg-neutral-900 px-5 py-3.5 ring-1 ring-white/5">
    <div class="metro-inner flex h-full flex-col">
      <!-- 3 colonnes : le choix du rythme reste centré au-dessus du tempo -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <div class="metro-title text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Métronome</div>
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
          <input v-model.number="volume" type="range" min="0" max="1" step="0.01" class="w-12 min-w-0 accent-copper-400" aria-label="Volume du métronome" :title="`Volume : ${volumeDb(volume) > 0 ? '+' : ''}${volumeDb(volume)} dB`" />
        </div>
      </div>

      <!-- Tempo : − 90 + , puis le nom du tempo et les temps de la mesure -->
      <div class="tempo flex flex-1 flex-col items-center justify-center">
        <div class="flex items-center gap-5">
          <button class="step" title="−5 BPM (flèche ↓ : −1)" @click="setBpm(bpm - 5)">−</button>
          <div class="bpm min-w-28 px-1 text-center leading-none font-black text-white tabular-nums">{{ bpm }}</div>
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
/* Module étroit : rythmes plus serrés, titre masqué */
@container (max-width: 400px) {
  .metro-title {
    display: none;
  }
  .sub {
    width: 2.25rem;
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
