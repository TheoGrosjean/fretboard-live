<script setup>
// Activité : une case par jour (16 dernières semaines), plus soutenue quand on a joué plus longtemps.
// Une seule teinte (cuivre) du plus clair au plus soutenu ; survol : le détail du jour.
import { computed, ref } from 'vue'
import { useWidth } from '../phrases/useWidth'

const props = defineProps({
  sessions: { type: Array, required: true }, // [{ at, duration (s) }] de tous les phrasés
})
const DAY = 24 * 3600 * 1000
const GAP = 3
// Taille selon la place : 26 semaines sur un grand écran, 16 sinon ; cases de 10 à 18 px
const box = ref(null)
const boxWidth = useWidth(box, 800)
const WEEKS = computed(() => (boxWidth.value > 760 ? 26 : 16))
const CELL = computed(() => Math.max(10, Math.min(18, Math.floor((boxWidth.value - 30) / WEEKS.value - GAP))))
const dayKey = (t) => new Date(t).toISOString().slice(0, 10) // sur le fuseau UTC : suffisant pour des jours
const local = (t) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const byDay = computed(() => {
  const map = new Map()
  for (const s of props.sessions) {
    const k = dayKey(local(s.at))
    const v = map.get(k) ?? { minutes: 0, sessions: 0 }
    v.minutes += (s.duration || 0) / 60
    v.sessions++
    map.set(k, v)
  }
  return map
})
// Grille : colonnes = semaines (lundi en haut), la dernière contient aujourd'hui
const cells = computed(() => {
  const today = local(Date.now())
  const weekday = (new Date(today).getDay() + 6) % 7 // 0 = lundi
  const start = today - (weekday + (WEEKS.value - 1) * 7) * DAY
  const out = []
  for (let w = 0; w < WEEKS.value; w++)
    for (let d = 0; d < 7; d++) {
      const t = start + (w * 7 + d) * DAY
      if (t > today) continue
      const v = byDay.value.get(dayKey(t)) ?? { minutes: 0, sessions: 0 }
      out.push({ t, w, d, ...v, level: level(v) })
    }
  return out
})
function level(v) {
  if (!v.sessions) return 0
  return v.minutes < 10 ? 1 : v.minutes < 20 ? 2 : v.minutes < 40 ? 3 : 4
}
const months = computed(() => {
  const out = []
  let last = -1
  for (const c of cells.value) {
    if (c.d !== 0) continue
    const m = new Date(c.t).getMonth()
    if (m !== last) {
      const label = { w: c.w, label: new Date(c.t).toLocaleDateString('fr-FR', { month: 'short' }) }
      // Deux mois sur des colonnes voisines (mois entamé à gauche) : on garde le second, lisible
      if (out.length && c.w - out.at(-1).w < 3) out[out.length - 1] = label
      else out.push(label)
    }
    last = m
  }
  return out
})
const width = computed(() => WEEKS.value * (CELL.value + GAP) + 26)
const height = computed(() => 7 * (CELL.value + GAP) + 18)
const activeDays = computed(() => cells.value.filter((c) => c.sessions).length)
const totalMinutes = computed(() => Math.round(cells.value.reduce((a, c) => a + c.minutes, 0)))

const hover = ref(null)
const fmtDay = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const fmtMinutes = (m) => (m < 1 ? 'moins d’une minute' : `${Math.round(m)} min`)
</script>

<template>
  <figure ref="box" class="heatmap">
    <figcaption class="mb-2 flex items-baseline justify-between gap-4">
      <span class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Activité · {{ WEEKS }} semaines</span>
      <span class="text-xs text-neutral-500">{{ activeDays }} jour{{ activeDays > 1 ? 's' : '' }} d'entraînement · {{ totalMinutes }} min</span>
    </figcaption>
    <div class="relative overflow-x-auto">
      <svg :width="width" :height="height" role="img" :aria-label="`Activité sur ${WEEKS} semaines : ${activeDays} jours d'entraînement, ${totalMinutes} minutes`" @pointerleave="hover = null">
        <text v-for="m in months" :key="m.w" :x="26 + m.w * (CELL + GAP)" y="9" class="axis">{{ m.label }}</text>
        <text v-for="[d, label] in [[0, 'lun'], [2, 'mer'], [4, 'ven']]" :key="d" x="0" :y="18 + d * (CELL + GAP) + CELL - 3" class="axis">{{ label }}</text>
        <rect
          v-for="c in cells"
          :key="c.t"
          :x="26 + c.w * (CELL + GAP)"
          :y="14 + c.d * (CELL + GAP)"
          :width="CELL"
          :height="CELL"
          rx="3"
          :class="[`l${c.level}`, { lift: hover?.t === c.t }]"
          @pointerenter="hover = c"
        />
      </svg>
      <div v-if="hover" class="tooltip" :style="{ left: Math.min(width - 190, 26 + hover.w * (CELL + GAP) - 80) + 'px', top: 14 + hover.d * (CELL + GAP) + 18 + 'px' }">
        <div class="font-black text-white">{{ hover.sessions ? fmtMinutes(hover.minutes) : 'repos' }}</div>
        <div class="text-neutral-400">{{ fmtDay(hover.t) }}<template v-if="hover.sessions"> · {{ hover.sessions }} séance{{ hover.sessions > 1 ? 's' : '' }}</template></div>
      </div>
    </div>
    <div class="mt-2 flex items-center gap-1.5 text-[11px] text-neutral-500">
      moins
      <svg v-for="l in [0, 1, 2, 3, 4]" :key="l" width="11" height="11"><rect width="11" height="11" rx="2.5" :class="`l${l}`" /></svg>
      plus
      <span class="ml-2 text-neutral-600">(&lt; 10, 20, 40 min et plus)</span>
    </div>
  </figure>
</template>

<style scoped>
@reference "../../style.css";

.axis {
  fill: #898781;
  font-size: 10px;
}
.l0 {
  fill: #262321;
}
.l1 {
  fill: color-mix(in srgb, #e2683a 30%, #262321);
}
.l2 {
  fill: color-mix(in srgb, #e2683a 55%, #262321);
}
.l3 {
  fill: color-mix(in srgb, #e2683a 78%, #262321);
}
.l4 {
  fill: #f0956a;
}
.lift {
  stroke: #f0efec;
  stroke-width: 1.5;
}
.tooltip {
  @apply pointer-events-none absolute z-10 w-48 rounded-lg px-3 py-2 text-xs shadow-xl ring-1 ring-white/10;
  background: #1f1d1b;
}
</style>
