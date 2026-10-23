<script setup>
// Tempo propre par séance : une courbe (le record de chaque séance), la cible en repère, et la tendance
// prolongée en pointillés jusqu'à la cible. Survol : repère vertical et détail de la séance. Vue tableau.
import { computed, ref } from 'vue'
import { useWidth } from './useWidth'
import { dayLabel, durationOf } from './format'

const props = defineProps({
  sessions: { type: Array, required: true }, // [{ at, bestBpm, maxBpm, passes, clean, duration }]
  target: { type: Number, required: true },
  forecast: { type: Object, default: null }, // projection() : { line: [a, b], sessions }
})

const box = ref(null)
const width = useWidth(box)
const H = 190
const M = { l: 34, r: 56, t: 14, b: 24 }
const table = ref(false)

const list = computed(() => props.sessions.slice(-30))
const offset = computed(() => props.sessions.length - list.value.length) // index de la 1re séance affichée
// Tendance prolongée : au plus 6 séances après la dernière, arrêtée à la cible
const ahead = computed(() => {
  const f = props.forecast
  if (!f?.line || !f.sessions || f.sessions > 12) return 0
  return Math.min(6, f.sessions)
})
const domain = computed(() => {
  const values = list.value.flatMap((s) => [s.bestBpm || null, s.maxBpm || null]).filter(Boolean)
  const lo = Math.min(props.target, ...values) - 6
  const hi = Math.max(props.target, ...values) + 6
  const step = hi - lo > 60 ? 20 : 10
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step }
})
const plotW = computed(() => width.value - M.l - M.r)
const count = computed(() => Math.max(1, list.value.length - 1 + ahead.value))
const x = (i) => M.l + (count.value ? (i / count.value) * plotW.value : plotW.value / 2)
const y = (v) => M.t + (1 - (v - domain.value.lo) / (domain.value.hi - domain.value.lo)) * (H - M.t - M.b)

const points = computed(() => list.value.map((s, i) => ({ i, s, x: x(i), y: s.bestBpm ? y(s.bestBpm) : null })))
// La courbe s'interrompt sur une séance sans passage propre
const path = computed(() => {
  let d = ''
  let open = false
  for (const p of points.value) {
    if (p.y === null) {
      open = false
      continue
    }
    d += `${open ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `
    open = true
  }
  return d
})
const lastPoint = computed(() => [...points.value].reverse().find((p) => p.y !== null) ?? null)
const projectionPath = computed(() => {
  const f = props.forecast
  const last = lastPoint.value
  if (!f?.line || !ahead.value || !last) return ''
  const [a, b] = f.line
  const end = list.value.length - 1 + ahead.value
  const v = Math.min(props.target, a + b * (end + offset.value))
  return `M ${last.x.toFixed(1)} ${last.y.toFixed(1)} L ${x(end).toFixed(1)} ${y(v).toFixed(1)}`
})
const ticks = computed(() => {
  const out = []
  for (let v = domain.value.lo; v <= domain.value.hi + 1e-6; v += domain.value.step) out.push(v)
  return out
})
const dateTicks = computed(() => {
  const n = list.value.length
  if (!n) return []
  const idx = n <= 4 ? [...Array(n).keys()] : [0, Math.round((n - 1) / 2), n - 1]
  return idx.map((i) => ({ x: x(i), label: dayLabel(list.value[i].at) }))
})

// Survol : la séance la plus proche du pointeur
const hover = ref(null)
function onMove(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const px = e.clientX - r.left
  if (!list.value.length) return
  const i = Math.max(0, Math.min(list.value.length - 1, Math.round(((px - M.l) / plotW.value) * count.value)))
  hover.value = points.value[i]
}
</script>

<template>
  <figure ref="box" class="chart">
    <figcaption class="chart-head">
      <span>Tempo propre par séance</span>
      <button class="chart-toggle" :aria-pressed="table" @click="table = !table">{{ table ? 'Graphique' : 'Tableau' }}</button>
    </figcaption>

    <div v-if="!list.length" class="empty">Les séances d'entraînement apparaîtront ici.</div>

    <table v-else-if="table" class="chart-table">
      <thead>
        <tr><th>Séance</th><th>Record propre</th><th>Tempo max</th><th>Passages</th><th>Propres</th><th>Durée</th></tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in [...list].reverse()" :key="s.at + '-' + i">
          <td>{{ dayLabel(s.at) }}</td>
          <td>{{ s.bestBpm ? `${s.bestBpm} BPM` : '—' }}</td>
          <td>{{ s.maxBpm || '—' }}</td>
          <td>{{ s.passes }}</td>
          <td>{{ s.passes ? Math.round((100 * s.clean) / s.passes) : 0 }} %</td>
          <td>{{ s.duration ? durationOf(s.duration) : '—' }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else class="relative">
      <svg :width="width" :height="H" class="block" role="img" :aria-label="`Record propre par séance, ${list.length} séances, cible ${target} BPM`" @pointermove="onMove" @pointerleave="hover = null">
        <!-- Grille et axe -->
        <g>
          <line v-for="v in ticks" :key="v" :x1="M.l" :x2="width - M.r" :y1="y(v)" :y2="y(v)" class="grid" />
          <text v-for="v in ticks" :key="'t' + v" :x="M.l - 6" :y="y(v) + 3" text-anchor="end" class="axis">{{ v }}</text>
          <text v-for="d in dateTicks" :key="'d' + d.x" :x="d.x" :y="H - 6" text-anchor="middle" class="axis">{{ d.label }}</text>
        </g>
        <!-- Cible -->
        <line :x1="M.l" :x2="width - M.r" :y1="y(target)" :y2="y(target)" class="target" />
        <text :x="width - M.r + 6" :y="y(target) + 3" class="label">cible {{ target }}</text>
        <!-- Tendance prolongée -->
        <path v-if="projectionPath" :d="projectionPath" class="projection" />
        <!-- Record par séance -->
        <path :d="path" class="series" />
        <circle v-for="p in points.filter((q) => q.y !== null)" :key="p.i" :cx="p.x" :cy="p.y" r="4" class="dot" />
        <text v-if="lastPoint" :x="lastPoint.x + 8" :y="lastPoint.y - 8" class="value">{{ lastPoint.s.bestBpm }}</text>
        <!-- Survol -->
        <g v-if="hover">
          <line :x1="hover.x" :x2="hover.x" :y1="M.t" :y2="H - M.b" class="crosshair" />
          <circle v-if="hover.y !== null" :cx="hover.x" :cy="hover.y" r="6" class="dot-hover" />
        </g>
      </svg>
      <div v-if="hover" class="tooltip" :style="{ left: Math.min(width - 170, Math.max(0, hover.x - 80)) + 'px' }">
        <div class="tt-value">{{ hover.s.bestBpm ? `${hover.s.bestBpm} BPM` : 'aucun passage propre' }}</div>
        <div class="tt-row"><span class="key" />record propre · {{ dayLabel(hover.s.at) }}</div>
        <div class="tt-muted">{{ hover.s.clean }}/{{ hover.s.passes }} propres{{ hover.s.maxBpm ? ` · jusqu'à ${hover.s.maxBpm} BPM` : '' }}{{ hover.s.duration ? ` · ${durationOf(hover.s.duration)}` : '' }}</div>
      </div>
    </div>
  </figure>
</template>

<style scoped>
@reference "../../style.css";

.chart {
  --series: #e2683a;
  --ink: #f0efec;
  --ink-2: #c3c2b7;
  --muted: #898781;
  --grid: #2c2c2a;
  --axis: #383835;
  --surface: #171717;
  @apply min-w-0;
}
.chart-head {
  @apply mb-2 flex items-center justify-between text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.chart-toggle {
  @apply rounded-md px-2 py-1 text-[10px] tracking-normal text-neutral-400 normal-case ring-1 ring-white/10 hover:text-white;
}
.empty {
  @apply flex h-40 items-center justify-center rounded-xl bg-white/[0.02] text-sm text-neutral-600 ring-1 ring-white/5;
}
.grid {
  stroke: var(--grid);
  stroke-width: 1;
}
.axis {
  fill: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.target {
  stroke: var(--ink-2);
  stroke-width: 1;
  opacity: 0.55;
}
.label {
  fill: var(--ink-2);
  font-size: 10px;
  font-weight: 600;
}
.projection {
  fill: none;
  stroke: var(--series);
  stroke-width: 2;
  stroke-dasharray: 4 5;
  opacity: 0.6;
}
.series {
  fill: none;
  stroke: var(--series);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.dot {
  fill: var(--series);
  stroke: var(--surface);
  stroke-width: 2;
}
.dot-hover {
  fill: var(--series);
  stroke: var(--ink);
  stroke-width: 2;
}
.value {
  fill: var(--ink);
  font-size: 12px;
  font-weight: 800;
}
.crosshair {
  stroke: var(--ink-2);
  stroke-width: 1;
  opacity: 0.4;
}
.tooltip {
  @apply pointer-events-none absolute top-1 w-44 rounded-lg px-3 py-2 text-xs shadow-xl ring-1 ring-white/10;
  background: #1f1d1b;
}
.tt-value {
  @apply text-sm font-black text-white;
}
.tt-row {
  @apply flex items-center gap-1.5 text-neutral-300;
}
.tt-row .key {
  @apply inline-block h-0.5 w-3 rounded;
  background: var(--series);
}
.tt-muted {
  @apply mt-0.5 text-neutral-500;
}
.chart-table {
  @apply w-full text-left text-xs text-neutral-300;
}
.chart-table th {
  @apply border-b border-white/10 pb-1.5 font-semibold text-neutral-500;
}
.chart-table td {
  @apply border-b border-white/5 py-1.5 tabular-nums;
}
</style>
