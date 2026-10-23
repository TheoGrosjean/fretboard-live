<script setup>
// Note par note : la réussite (colonnes, le point dur mis en avant, le reste en retrait) et le timing
// (colonnes de part et d'autre de zéro : en avance en bleu, en retard en cuivre). Survol : détail de la note.
import { computed, ref } from 'vue'
import { noteName } from '../../lib/music'
import { useWidth } from './useWidth'

const props = defineProps({
  notes: { type: Array, required: true },
  profile: { type: Array, required: true }, // noteProfile() : [{ index, rate, off, abs, tries }]
  spot: { type: Object, default: null }, // hardSpot() : { start, end }
  notation: { type: String, default: 'fr' },
})

const box = ref(null)
const width = useWidth(box)
const M = { l: 34, r: 12 }
const RATE_H = 92
const TIME_H = 96
const table = ref(false)

const n = computed(() => props.notes.length)
const band = computed(() => (width.value - M.l - M.r) / Math.max(1, n.value))
const barW = computed(() => Math.max(4, Math.min(24, band.value * 0.62)))
const cx = (i) => M.l + band.value * (i + 0.5)
const known = computed(() => props.profile.some((p) => p.rate !== null))
const inSpot = (i) => props.spot && i >= props.spot.start && i <= props.spot.end

// Colonne arrondie côté donnée (4 px), carrée côté ligne de base
function column(x, base, top, w) {
  const r = Math.min(4, Math.abs(base - top), w / 2)
  const up = top < base
  const t = up ? top + r : top - r
  return `M ${x} ${base} V ${t} Q ${x} ${top} ${x + r} ${top} H ${x + w - r} Q ${x + w} ${top} ${x + w} ${t} V ${base} Z`
}
const rateBars = computed(() =>
  props.profile.map((p, i) => {
    const h = p.rate === null ? 0 : Math.max(2, p.rate * (RATE_H - 16))
    return { i, p, d: p.rate === null ? '' : column(cx(i) - barW.value / 2, RATE_H, RATE_H - h, barW.value), cls: inSpot(i) ? 'emph' : 'base' }
  }),
)
const maxOff = computed(() => Math.max(40, ...props.profile.filter((p) => p.rate !== null).map((p) => Math.abs(p.off))))
const mid = TIME_H / 2
const timeBars = computed(() =>
  props.profile.map((p, i) => {
    if (p.rate === null || Math.abs(p.off) < 3) return { i, p, d: '' }
    const h = (Math.abs(p.off) / maxOff.value) * (mid - 10)
    const top = p.off > 0 ? mid - h : mid + h
    return { i, p, d: column(cx(i) - barW.value / 2, mid, top, barW.value), cls: p.off > 0 ? 'late' : 'early' }
  }),
)
const labelEvery = computed(() => Math.ceil(n.value / Math.max(1, Math.floor((width.value - M.l) / 26))))

const hover = ref(null)
function onMove(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const i = Math.floor((e.clientX - r.left - M.l) / band.value)
  hover.value = i >= 0 && i < n.value ? i : null
}
const hp = computed(() => (hover.value === null ? null : props.profile[hover.value]))
const timingText = (off) => (Math.abs(off) < 5 ? 'pile dans le temps' : off < 0 ? `${-off} ms en avance` : `${off} ms en retard`)
</script>

<template>
  <figure ref="box" class="chart">
    <figcaption class="chart-head">
      <span>Note par note</span>
      <button v-if="known" class="chart-toggle" :aria-pressed="table" @click="table = !table">{{ table ? 'Graphique' : 'Tableau' }}</button>
    </figcaption>

    <div v-if="!known" class="empty">Après quelques passages, chaque note montre ici sa réussite et son timing.</div>

    <table v-else-if="table" class="chart-table">
      <thead>
        <tr><th>Note</th><th>Réussite</th><th>Timing moyen</th><th>Essais</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in profile" :key="p.index">
          <td>{{ p.index + 1 }} · {{ noteName(notes[p.index].midi, notation) }}</td>
          <td>{{ p.rate === null ? '—' : Math.round(p.rate * 100) + ' %' }}</td>
          <td>{{ p.rate === null ? '—' : timingText(p.off) }}</td>
          <td>{{ p.tries }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else class="relative">
      <svg :width="width" :height="RATE_H + TIME_H + 30" class="block" role="img" aria-label="Réussite et timing de chaque note" @pointermove="onMove" @pointerleave="hover = null">
        <!-- Réussite -->
        <text :x="M.l" :y="9" class="title">Réussite</text>
        <line :x1="M.l" :x2="width - M.r" :y1="16" :y2="16" class="grid" />
        <text :x="M.l - 6" :y="19" text-anchor="end" class="axis">100</text>
        <line :x1="M.l" :x2="width - M.r" :y1="RATE_H" :y2="RATE_H" class="baseline" />
        <text :x="M.l - 6" :y="RATE_H + 3" text-anchor="end" class="axis">0</text>
        <path v-for="b in rateBars" :key="'r' + b.i" :d="b.d" :class="[b.cls, { lift: hover === b.i }]" />

        <!-- Timing -->
        <g :transform="`translate(0 ${RATE_H + 8})`">
          <text :x="M.l" :y="9" class="title">Timing</text>
          <line :x1="M.l" :x2="width - M.r" :y1="mid" :y2="mid" class="baseline" />
          <text :x="M.l - 6" :y="14" text-anchor="end" class="axis">tard</text>
          <text :x="M.l - 6" :y="TIME_H - 4" text-anchor="end" class="axis">tôt</text>
          <path v-for="b in timeBars" :key="'t' + b.i" :d="b.d" :class="[b.cls, { lift: hover === b.i }]" />
        </g>

        <!-- Notes -->
        <template v-for="p in profile" :key="'n' + p.index">
          <text v-if="p.index % labelEvery === 0" :x="cx(p.index)" :y="RATE_H + TIME_H + 24" text-anchor="middle" class="axis">{{ p.index + 1 }}</text>
        </template>
        <rect v-if="hover !== null" :x="cx(hover) - band / 2" :y="0" :width="band" :height="RATE_H + TIME_H + 12" class="hover-band" />
      </svg>
      <div v-if="hp" class="tooltip" :style="{ left: Math.min(width - 180, Math.max(0, cx(hover) - 90)) + 'px' }">
        <div class="tt-value">{{ hp.rate === null ? 'pas encore assez joué' : Math.round(hp.rate * 100) + ' % de réussite' }}</div>
        <div class="tt-muted">Note {{ hp.index + 1 }} · {{ noteName(notes[hp.index].midi, notation) }} · {{ hp.tries }} essai{{ hp.tries > 1 ? 's' : '' }}</div>
        <div v-if="hp.rate !== null" class="tt-row"><span class="key" :class="hp.off < 0 ? 'early' : 'late'" />{{ timingText(hp.off) }}</div>
      </div>
      <div class="legend">
        <span><i class="sw base" />réussite</span>
        <span v-if="spot"><i class="sw emph" />point dur</span>
        <span><i class="sw early" />en avance</span>
        <span><i class="sw late" />en retard</span>
      </div>
    </div>
  </figure>
</template>

<style scoped>
@reference "../../style.css";

.chart {
  --base: #78716c;
  --emph: #fbbf24; /* point dur : la couleur d’alerte, distincte du cuivre « en retard » */
  --early: #3d8fd6;
  --late: #e2683a;
  --ink: #f0efec;
  --muted: #898781;
  --grid: #2c2c2a;
  --axis: #383835;
  @apply min-w-0;
}
.chart-head {
  @apply mb-2 flex items-center justify-between text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.chart-toggle {
  @apply rounded-md px-2 py-1 text-[10px] tracking-normal text-neutral-400 normal-case ring-1 ring-white/10 hover:text-white;
}
.empty {
  @apply flex h-40 items-center justify-center rounded-xl bg-white/[0.02] px-6 text-center text-sm text-neutral-600 ring-1 ring-white/5;
}
.title {
  fill: var(--muted);
  font-size: 10px;
  font-weight: 700;
}
.grid {
  stroke: var(--grid);
  stroke-width: 1;
}
.baseline {
  stroke: var(--axis);
  stroke-width: 1;
}
.axis {
  fill: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.base {
  fill: var(--base);
}
.emph {
  fill: var(--emph);
}
.early {
  fill: var(--early);
}
.late {
  fill: var(--late);
}
.lift {
  filter: brightness(1.25);
}
.hover-band {
  fill: #fff;
  opacity: 0.04;
  pointer-events: none;
}
.tooltip {
  @apply pointer-events-none absolute top-1 w-48 rounded-lg px-3 py-2 text-xs shadow-xl ring-1 ring-white/10;
  background: #1f1d1b;
}
.tt-value {
  @apply text-sm font-black text-white;
}
.tt-muted {
  @apply text-neutral-500;
}
.tt-row {
  @apply mt-0.5 flex items-center gap-1.5 text-neutral-300;
}
.key {
  @apply inline-block h-0.5 w-3 rounded;
}
.key.early {
  background: var(--early);
}
.key.late {
  background: var(--late);
}
.legend {
  @apply mt-2 flex flex-wrap gap-4 text-[11px] text-neutral-400;
}
.legend span {
  @apply flex items-center gap-1.5;
}
.sw {
  @apply inline-block size-2.5 rounded-sm;
}
.sw.base {
  background: var(--base);
}
.sw.emph {
  background: var(--emph);
}
.sw.early {
  background: var(--early);
}
.sw.late {
  background: var(--late);
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
