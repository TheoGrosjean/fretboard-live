<script setup>
// Progrès : les chiffres clés du phrasé, la courbe du tempo séance après séance, le détail note par note,
// et ce que l'app en conclut (point dur, transitions précipitées, projection, prochaine révision).
import { computed, inject } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import { reviewLabel } from '../../lib/phraseCoach'
import { noteName } from '../../lib/music'
import NoteChart from './NoteChart.vue'
import TempoChart from './TempoChart.vue'
import { dayLabel, durationOf } from './format'

const s = inject(STUDIO_KEY)
const p = computed(() => s.phrase)
const totals = computed(() => {
  const list = p.value.sessions
  const passes = list.reduce((a, x) => a + x.passes, 0)
  const clean = list.reduce((a, x) => a + x.clean, 0)
  return { sessions: list.length, passes, cleanPct: passes ? Math.round((100 * clean) / passes) : 0, time: list.reduce((a, x) => a + (x.duration || 0), 0) }
})
const review = computed(() => reviewLabel(p.value))
const forecastText = computed(() => {
  const f = s.forecast
  if (!f) return 'Encore quelques séances avant de voir une tendance.'
  if (f.sessions === 0) return 'Cible atteinte : monte la cible, ou garde ce phrasé en révision.'
  if (f.sessions === null) return `Le record stagne (${f.slope >= 0 ? '+' : ''}${f.slope.toFixed(1)} BPM par séance) : essaie la méthode Rafales, ou une section en boucle.`
  return `À ce rythme (+${f.slope.toFixed(1)} BPM par séance), la cible est à environ ${f.sessions} séance${f.sessions > 1 ? 's' : ''}.`
})
const driftText = (d) => {
  const a = p.value.notes[d.index - 1]
  const b = p.value.notes[d.index]
  return `${d.ms < 0 ? 'Tu presses' : 'Tu retiens'} entre la note ${d.index} (${noteName(a.midi, s.notation)}) et la ${d.index + 1} (${noteName(b.midi, s.notation)}) : ${Math.abs(d.ms)} ms`
}
const steadiness = computed(() => {
  const known = s.profile.filter((x) => x.rate !== null)
  return known.length ? Math.round(known.reduce((a, x) => a + x.abs, 0) / known.length) : null
})
function resetStats() {
  p.value.noteStats = {}
}
</script>

<template>
  <section class="panel">
    <!-- Chiffres clés -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <div class="tile">
        <span class="tile-label">Record propre</span>
        <span class="tile-value">{{ p.bestBpm || '—' }}<small v-if="p.bestBpm"> BPM</small></span>
        <span class="tile-sub">cible {{ p.targetBpm }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Maîtrise</span>
        <span class="tile-value">{{ s.masteryPct }}<small> %</small></span>
        <span class="meter"><i :style="{ width: s.masteryPct + '%' }" /></span>
      </div>
      <div class="tile">
        <span class="tile-label">Séances</span>
        <span class="tile-value">{{ totals.sessions }}</span>
        <span class="tile-sub">{{ totals.time ? durationOf(totals.time) + ' au total' : 'pas encore' }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Passages propres</span>
        <span class="tile-value">{{ totals.cleanPct }}<small> %</small></span>
        <span class="tile-sub">sur {{ totals.passes }} passage{{ totals.passes > 1 ? 's' : '' }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Prochaine révision</span>
        <span class="tile-value text-2xl" :class="review === 'à revoir' ? 'text-copper-300' : ''">{{ review || '—' }}</span>
        <span class="tile-sub">{{ p.review ? `revu ${dayLabel(p.review.last)}` : 'après la 1re séance' }}</span>
      </div>
    </div>

    <div class="mt-5 grid gap-6 xl:grid-cols-2">
      <TempoChart :sessions="p.sessions" :target="p.targetBpm" :forecast="s.forecast" />
      <NoteChart :notes="p.notes" :profile="s.profile" :spot="s.spot" :notation="s.notation" />
    </div>

    <!-- Ce que l'app en conclut -->
    <div class="mt-5 grid gap-3 lg:grid-cols-2">
      <div class="insight">
        <b>Tendance</b>
        <p>{{ forecastText }}</p>
      </div>
      <div class="insight" :class="{ warn: s.spot }">
        <b>Point dur</b>
        <p v-if="s.spot">
          Notes {{ s.spot.start + 1 }} à {{ s.spot.end + 1 }} : {{ Math.round(s.spot.rate * 100) }} % de réussite.
          <button class="link" @click="s.workOnSpot">Les travailler en boucle →</button>
        </p>
        <p v-else>Rien ne se détache pour l'instant : la difficulté est répartie sur le phrasé.</p>
      </div>
      <div class="insight">
        <b>Transitions</b>
        <p v-if="s.drifts.length">{{ driftText(s.drifts[0]) }}<template v-if="s.drifts[1]"> · {{ driftText(s.drifts[1]) }}</template></p>
        <p v-else>Aucune transition ne presse ni ne retient nettement.</p>
      </div>
      <div class="insight">
        <b>Régularité</b>
        <p v-if="steadiness !== null">En moyenne, tes notes tombent à {{ steadiness }} ms du temps{{ steadiness < 20 ? ' : très précis.' : steadiness < 40 ? '.' : ' : ralentis un peu pour gagner en précision.' }}</p>
        <p v-else>Les mesures arrivent après quelques passages.</p>
      </div>
    </div>

    <div class="mt-4 flex justify-end">
      <button v-if="s.profile.some((x) => x.tries)" class="text-xs font-semibold text-neutral-600 hover:text-neutral-300" @click="resetStats">Réinitialiser les statistiques des notes</button>
    </div>
  </section>
</template>

<style scoped>
@reference "../../style.css";

.panel {
  @apply rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5;
}
.tile {
  @apply flex flex-col gap-1 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5;
}
.tile-label {
  @apply text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.tile-value {
  @apply text-3xl leading-none font-black text-white;
}
.tile-value small {
  @apply text-sm font-semibold text-neutral-500;
}
.tile-sub {
  @apply text-xs text-neutral-500;
}
.meter {
  @apply mt-1 h-1.5 overflow-hidden rounded-full bg-copper-500/20;
}
.meter i {
  @apply block h-full rounded-full bg-copper-500;
}
.insight {
  @apply rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-neutral-400 ring-1 ring-white/5;
}
.insight b {
  @apply text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.insight p {
  @apply mt-1;
}
.insight.warn {
  @apply bg-amber-400/[0.05] ring-amber-300/25;
}
.link {
  @apply ml-1 font-semibold text-copper-300 hover:text-copper-400;
}
</style>
