<script setup>
// Entraînement : tableau de bord en direct (tempo, passage en cours, timing, bilan) et réglages
// (méthode de progression, exigence, aides, calage du micro).
import { computed, inject } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import { GRADES, METHODS, TOLERANCES } from '../../lib/phraseCoach'
import { noteName } from '../../lib/music'
import { beatLabel, offsetLabel } from './format'

const s = inject(STUDIO_KEY)
const p = computed(() => s.phrase)
const practicing = computed(() => s.mode === 'practice')
const hudBpm = computed(() => (practicing.value ? s.metro.bpm.value : p.value.bpm))
const method = computed(() => METHODS.find((m) => m.id === p.value.method) ?? METHODS[0])

const progress = computed(() => {
  const span = Math.max(1, p.value.targetBpm - p.value.startBpm)
  const pct = (v) => Math.min(100, Math.max(0, ((v - p.value.startBpm) / span) * 100))
  return { current: pct(hudBpm.value), best: p.value.bestBpm ? pct(p.value.bestBpm) : null }
})

// Passage en cours : notes justes jusqu'ici (anneau)
const live = computed(() => {
  const pass = s.shownPass
  if (!practicing.value || !pass || pass.kind === 'demo') return null
  const total = pass.targets.length
  const hits = pass.targets.filter((t) => t.state === 'hit').length
  const misses = pass.targets.filter((t) => t.state === 'miss').length
  return { total, hits, misses, ratio: total ? hits / total : 0, burst: pass.kind === 'burst' }
})
const RING = 2 * Math.PI * 30
// Pendant la pause, le passage affiché est celui qui vient de finir (déjà compté dans les bilans)
const passNumber = computed(() => s.results.length + (live.value && !s.shownPass?.done ? 1 : 0))

// Aiguille de timing : dernière note juste, sur ± la tolérance
const needle = computed(() => {
  const o = s.lastOffset
  if (!o) return null
  const tol = s.toleranceMs
  return { x: 50 + (Math.max(-tol, Math.min(tol, o.ms)) / tol) * 50, ms: o.ms, id: o.id }
})

const last = computed(() => s.results[0] ?? null)
const techOnly = (r) => r.hits === r.total && r.wrong === 0 && r.techOk < r.techTotal
const notesText = (list) => list.map((i) => `${noteName((p.value.notes[i]?.midi ?? 0) + (last.value?.transpose ?? 0), s.notation)} (n°${i + 1})`).join(', ')

const memoryOptions = [
  { id: 'guided', label: 'Tout le phrasé' },
  { id: 'next', label: 'La note suivante' },
  { id: 'blind', label: 'De mémoire' },
  { id: 'auto', label: 'Progressif' },
]
const demoOptions = [
  { id: 'off', label: 'Aucune' },
  { id: 'call', label: 'Écoute puis joue' },
  { id: 'along', label: 'Joue avec toi' },
]
const clickOptions = [
  { id: 'off', label: 'Toujours' },
  { id: 'bars', label: 'Coupé 1 mesure sur 2' },
  { id: 'passes', label: 'Coupé 1 passage sur 2' },
]
const keyOptions = [
  { id: 'off', label: 'Fixe' },
  { id: 'fourths', label: 'Cycle des quartes' },
  { id: 'chromatic', label: 'Demi-ton par demi-ton' },
]
const loopText = computed(() => (p.value.loop ? `${beatLabel(p.value.loop.from, p.value.beats)} → ${beatLabel(p.value.loop.to, p.value.beats)}` : ''))
</script>

<template>
  <section class="panel">
    <!-- ========== Tableau de bord ========== -->
    <div class="grid gap-4 md:grid-cols-2 2xl:grid-cols-[1.25fr_1fr_1fr]">
      <!-- Tempo -->
      <div class="hud-card md:col-span-2 2xl:col-span-1">
        <div class="hud-label">
          Tempo
          <span class="method-chip" :title="method.hint">{{ method.label }}</span>
        </div>
        <div class="mt-1 flex items-baseline gap-2">
          <span class="text-5xl leading-none font-black text-white">{{ hudBpm }}</span>
          <span class="text-sm text-neutral-500">BPM</span>
          <span v-if="live?.burst" class="ml-1 text-xs font-bold text-amber-300">⚡ rafale</span>
          <span class="ml-auto text-right text-xs text-neutral-500">
            cible <b class="text-neutral-300">{{ p.targetBpm }}</b>
            <template v-if="p.bestBpm"><br />record <b class="text-copper-300">{{ p.bestBpm }}</b></template>
          </span>
        </div>
        <div class="relative mt-3 h-2 rounded-full bg-neutral-800">
          <div class="absolute inset-y-0 left-0 rounded-full bg-copper-500 transition-[width] duration-500" :style="{ width: progress.current + '%' }" />
          <span v-if="progress.best !== null" class="absolute -top-1 h-4 w-0.5 rounded bg-white/80" :style="{ left: progress.best + '%' }" title="Record" />
        </div>
        <div class="mt-1 flex justify-between text-[10px] text-neutral-600 tabular-nums">
          <span>{{ p.startBpm }}</span>
          <span>{{ p.targetBpm }}</span>
        </div>
        <div class="mt-3 flex items-center gap-2 text-xs text-neutral-400">
          <template v-if="p.method !== 'manual'">
            <span v-for="r in p.reps" :key="r" class="streak" :class="{ on: r <= s.streak }" />
            <span>{{ s.streak }}/{{ p.reps }} propres avant +{{ p.step }}</span>
          </template>
          <span v-else>Tu règles le tempo au métronome</span>
          <button v-if="s.mode === 'idle' && p.bpm !== p.startBpm" class="ml-auto font-semibold text-neutral-500 hover:text-neutral-300" @click="s.resetProgress">Repartir de {{ p.startBpm }}</button>
        </div>
      </div>

      <!-- Passage en cours -->
      <div class="hud-card flex items-center gap-4">
        <svg class="size-20 shrink-0 -rotate-90" viewBox="0 0 72 72" aria-hidden="true">
          <circle cx="36" cy="36" r="30" fill="none" stroke="#292524" stroke-width="7" />
          <circle v-if="live" cx="36" cy="36" r="30" fill="none" stroke="#10b981" stroke-width="7" stroke-linecap="round" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - live.ratio)" class="transition-[stroke-dashoffset] duration-150" />
        </svg>
        <div class="min-w-0">
          <div class="hud-label">{{ s.demoPlaying ? 'Démo' : practicing ? `Passage ${passNumber || 1}` : 'Passage' }}</div>
          <div v-if="live" class="text-2xl font-black text-white">
            {{ live.hits }}<span class="text-neutral-500">/{{ live.total }}</span>
            <span v-if="live.misses" class="ml-1 text-sm text-rose-300">−{{ live.misses }}</span>
          </div>
          <div v-else-if="s.demoPlaying" class="text-sm font-bold text-copper-300">🎧 Écoute la démo…</div>
          <div v-else-if="practicing && s.counting" class="text-sm font-bold text-copper-300">Prêt…</div>
          <div v-else class="text-sm text-neutral-600">{{ practicing ? 'Pause' : 'Lance l’entraînement : le phrasé tourne en boucle.' }}</div>
          <div class="mt-1 flex flex-wrap gap-1">
            <span v-if="s.clickMuted" class="status-chip">Clic coupé · garde le tempo</span>
            <span v-if="practicing && s.memoryShown" class="status-chip">Mémoire {{ s.memoryShown }}/2</span>
            <span v-if="practicing && s.transposeNow" class="status-chip">Tonalité {{ s.transposeNow > 0 ? '+' : '' }}{{ s.transposeNow }}</span>
            <span v-if="practicing && p.loop" class="status-chip">Boucle {{ loopText }}</span>
          </div>
        </div>
      </div>

      <!-- Timing -->
      <div class="hud-card">
        <div class="hud-label">Timing</div>
        <div class="relative mt-4 h-8">
          <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-linear-to-r from-[#3d8fd6]/50 via-neutral-700 to-[#e2683a]/50" />
          <span class="absolute top-0 left-1/2 h-8 w-px bg-white/40" />
          <span v-if="needle" :key="needle.id" class="needle" :style="{ left: needle.x + '%' }" />
        </div>
        <div class="mt-1 flex justify-between text-[10px] text-neutral-600">
          <span>en avance</span>
          <span>en retard</span>
        </div>
        <div class="mt-2 text-sm font-semibold" :class="needle && Math.abs(needle.ms) < 25 ? 'text-emerald-300' : 'text-neutral-300'">{{ needle ? offsetLabel(needle.ms) : '—' }}</div>
        <div v-if="s.lastAdjust && practicing" class="text-[11px] text-neutral-500">calage ajusté {{ s.lastAdjust > 0 ? '+' : '' }}{{ s.lastAdjust }} ms</div>
      </div>
    </div>

    <!-- Dernier passage -->
    <div class="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/5">
      <template v-if="last">
        <div class="grade" :class="`g-${last.grade}`" :title="GRADES[last.grade].hint">{{ last.grade }}</div>
        <div class="min-w-48 flex-1">
          <div class="font-black" :class="last.clean ? 'text-emerald-400' : techOnly(last) ? 'text-amber-300' : 'text-rose-300'">
            {{ last.clean ? 'Propre ✓' : techOnly(last) ? 'Techniques à revoir' : `${last.hits}/${last.total} notes` }}
            <span class="ml-2 text-sm font-semibold text-neutral-500">{{ last.score }}/100 · {{ last.bpm }} BPM</span>
          </div>
          <div class="mt-1 space-y-0.5 text-xs text-neutral-400">
            <div v-if="last.missed.length">Ratée{{ last.missed.length > 1 ? 's' : '' }} : <span class="text-rose-300">{{ notesText(last.missed) }}</span></div>
            <div v-if="last.wrong">En trop : <span class="text-rose-300">{{ last.wrongNotes.map((m) => noteName(m, s.notation)).join(', ') }}</span></div>
            <div v-if="last.techTotal">
              Techniques : <span :class="last.techOk === last.techTotal ? 'text-emerald-300' : 'text-amber-300'">{{ last.techOk }}/{{ last.techTotal }}</span>
              <template v-if="last.techMissed.length"> · à revoir : {{ last.techMissed.map((i) => `n°${i + 1}`).join(', ') }}</template>
            </div>
            <div v-if="last.hits">{{ offsetLabel(last.avgOffset) }} · régularité ±{{ last.spread }} ms</div>
          </div>
        </div>
        <div class="flex max-w-64 flex-wrap justify-end gap-1">
          <span v-for="r in s.results" :key="r.n" class="pass-chip" :class="r.clean ? 'ok' : 'ko'" :title="`Passage ${r.n} à ${r.bpm} BPM : ${r.hits}/${r.total} · ${r.score}/100`">{{ r.grade }}</span>
        </div>
      </template>
      <p v-else class="text-sm text-neutral-600">Chaque passage reçoit une note de S à D : justesse, précision rythmique, régularité et techniques.</p>
    </div>

    <!-- Point dur -->
    <div v-if="s.spot && s.mode === 'idle'" class="spot">
      <span>
        Point dur : notes {{ s.spot.start + 1 }} à {{ s.spot.end + 1 }} (<b>{{ Math.round(s.spot.rate * 100) }} %</b> de réussite)
      </span>
      <button class="tool is-accent" @click="s.workOnSpot">Le travailler en boucle</button>
    </div>

    <!-- ========== Réglages ========== -->
    <div class="mt-5 border-t border-white/5 pt-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="hud-label">Méthode</span>
        <div class="segmented">
          <button v-for="m in METHODS" :key="m.id" :class="{ on: p.method === m.id }" :disabled="practicing" :title="m.hint" @click="p.method = m.id">{{ m.label }}</button>
        </div>
        <span class="text-xs text-neutral-500">{{ method.hint }}</span>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label class="setting">
          <span>Départ</span>
          <input :value="p.startBpm" type="number" min="40" max="240" class="num" @change="s.setStartBpm($event.target.value), ($event.target.value = p.startBpm)" @keydown.enter="$event.target.blur()" />
        </label>
        <label class="setting">
          <span>Cible</span>
          <input :value="p.targetBpm" type="number" min="40" max="240" class="num" @change="s.setTargetBpm($event.target.value), ($event.target.value = p.targetBpm)" @keydown.enter="$event.target.blur()" />
        </label>
        <label class="setting">
          <span>Palier</span>
          <select v-model.number="p.step" class="num" :disabled="p.method === 'manual'">
            <option v-for="v in [1, 2, 3, 5, 10]" :key="v" :value="v">+{{ v }} BPM</option>
          </select>
        </label>
        <label class="setting">
          <span title="Passages propres d'affilée avant de monter d'un palier">Monter après</span>
          <select v-model.number="p.reps" class="num" :disabled="p.method === 'manual'">
            <option v-for="v in [1, 2, 3, 4, 5]" :key="v" :value="v">{{ v }} ✓</option>
          </select>
        </label>
        <label v-if="p.method === 'bursts'" class="setting">
          <span title="Vitesse des passages « rafale »">Rafale</span>
          <select v-model.number="p.burst" class="num">
            <option v-for="v in [10, 15, 20, 25]" :key="v" :value="v">+{{ v }} %</option>
          </select>
        </label>
        <label class="setting">
          <span>Pause</span>
          <select v-model.number="p.rest" class="num" :disabled="practicing">
            <option :value="0">Aucune</option>
            <option :value="1">1 mes.</option>
            <option :value="2">2 mes.</option>
          </select>
        </label>
        <label class="setting">
          <span>Tolérance</span>
          <select v-model="s.toleranceId" class="num">
            <option v-for="t in TOLERANCES" :key="t.id" :value="t.id" :title="`± ${t.ms} ms autour du temps`">{{ t.label }}</option>
          </select>
        </label>
      </div>

      <!-- Aides -->
      <div class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label class="setting">
          <span title="Ce que le manche et la tablature montrent pendant l'entraînement. Progressif : les aides disparaissent après 2 passages propres, reviennent après un raté">Aides visuelles</span>
          <select v-model="s.memory" class="num" :disabled="practicing">
            <option v-for="o in memoryOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <label class="setting">
          <span title="Le phrasé joué par l'app, au tempo du passage. « Joue avec toi » : à éviter avec un micro d'ambiance (il entendrait la démo)">Démo sonore</span>
          <select v-model="s.demo" class="num" :disabled="practicing">
            <option v-for="o in demoOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <label class="setting">
          <span title="Le métronome se tait par moments : ton tempo intérieur fait le travail">Clic</span>
          <select v-model="s.gapClick" class="num">
            <option v-for="o in clickOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <label class="setting">
          <span title="Après chaque passage propre, le phrasé change de tonalité">Tonalité</span>
          <select v-model="s.keyCycle" class="num" :disabled="practicing">
            <option v-for="o in keyOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-neutral-400">
        <label class="flex cursor-pointer items-center gap-2" title="Sinon, les techniques (liés, slides, bends) sont vérifiées et affichées mais n'empêchent pas un passage d'être propre">
          <input v-model="s.requireTech" type="checkbox" class="size-4 accent-copper-400" />
          Exiger les techniques
        </label>
        <label v-if="s.demo !== 'off'" class="flex items-center gap-2">
          Volume de la démo
          <input v-model.number="s.guideVolume" type="range" min="0" max="1.5" step="0.05" class="w-24 accent-copper-400" />
        </label>
        <label class="flex cursor-pointer items-center gap-2" title="Pendant l'entraînement, le calage se corrige tout seul si tes notes arrivent toujours avec le même retard">
          <input v-model="s.autoLatency" type="checkbox" class="size-4 accent-copper-400" />
          Calage auto
        </label>
        <label class="flex items-center gap-2" title="Délai entre le moment où tu joues et celui où la note est reconnue. Si tes notes sortent toujours « en retard », augmente-le.">
          Calage
          <input v-model.number="s.latency" type="range" min="0" max="250" step="5" class="w-28 accent-copper-400" />
          <span class="w-12 text-neutral-500 tabular-nums">{{ s.latency }} ms</span>
        </label>
        <button class="tool" :disabled="practicing" title="Mesure le délai de ton installation : joue une note sur chaque clic" @click="s.openCalibration">Calibrer…</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
@reference "../../style.css";

.panel {
  @apply rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5;
}
.hud-card {
  @apply rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5;
}
.hud-label {
  @apply flex items-center gap-2 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.method-chip {
  @apply rounded-full bg-copper-500/15 px-2 py-0.5 text-[10px] tracking-normal text-copper-300 normal-case ring-1 ring-copper-400/30;
}
.status-chip {
  @apply rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-neutral-300 ring-1 ring-white/10;
}
.streak {
  @apply size-3 rounded-full bg-neutral-800 ring-1 ring-white/10 transition;
}
.streak.on {
  @apply bg-emerald-400 ring-emerald-300 shadow-[0_0_8px] shadow-emerald-400/60;
}
.needle {
  @apply absolute top-0 h-8 w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px] shadow-white/70;
  animation: needle-in 0.25s ease-out;
}
@keyframes needle-in {
  from {
    transform: translateX(-50%) scaleY(0.4);
    opacity: 0.4;
  }
}
.grade {
  @apply flex size-14 shrink-0 items-center justify-center rounded-xl text-3xl font-black ring-1;
}
.g-S {
  @apply bg-amber-400/15 text-amber-300 ring-amber-300/50 shadow-[0_0_24px] shadow-amber-400/20;
}
.g-A {
  @apply bg-emerald-500/15 text-emerald-300 ring-emerald-400/40;
}
.g-B {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40;
}
.g-C {
  @apply bg-amber-600/10 text-amber-400/80 ring-amber-500/30;
}
.g-D {
  @apply bg-rose-500/10 text-rose-300 ring-rose-400/30;
}
.pass-chip {
  @apply flex size-6 items-center justify-center rounded-md text-[11px] font-black;
}
.pass-chip.ok {
  @apply bg-emerald-500/15 text-emerald-300;
}
.pass-chip.ko {
  @apply bg-rose-500/15 text-rose-300;
}
.spot {
  @apply mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-400/[0.06] px-4 py-2.5 text-sm text-neutral-300 ring-1 ring-amber-300/25;
}
.segmented {
  @apply flex rounded-xl bg-neutral-800 p-1;
}
.segmented button {
  @apply rounded-lg px-3 py-1.5 text-xs font-bold text-neutral-400 transition hover:text-white disabled:opacity-50;
}
.segmented button.on {
  @apply bg-copper-500 text-white;
}
.setting {
  @apply flex flex-col gap-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase;
}
.num {
  @apply h-9 rounded-lg bg-neutral-800 px-2.5 text-sm font-semibold tracking-normal text-neutral-100 normal-case ring-1 ring-white/10 outline-none focus:ring-copper-400/60 disabled:opacity-50;
}
.tool {
  @apply flex h-7 items-center rounded-lg bg-neutral-800 px-2.5 text-xs font-semibold text-neutral-300 ring-1 ring-white/10 transition outline-none hover:bg-neutral-700 hover:text-white disabled:opacity-35;
}
.tool.is-accent {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40 hover:bg-copper-500/25;
}
</style>
