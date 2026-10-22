<script setup>
// Page Théorie : cours interactifs (gammes, bases de l'impro…), regroupés en parcours. Voir lib/lessons.js.
import { computed, reactive, ref, watch } from 'vue'
import Fretboard from './components/Fretboard.vue'
import Icon from './components/Icon.vue'
import { ALL_LESSONS, COURSES } from './lib/lessons'
import { ARPEGGIOS, SCALES, STANDARD_TUNING, buildOverlay } from './lib/music'
import { CHORDS } from './lib/chords'
import { scaleBoxes } from './lib/boxes'
import { FEELINGS } from './lib/feelings'
import { pluck } from './lib/pluck'
import { practiceRequest } from './lib/practice'

function stored(key, initial) {
  try {
    const v = localStorage.getItem(key)
    return v !== null ? JSON.parse(v) : initial
  } catch {
    return initial
  }
}
// Réglages d'affichage du Manche, repris pour les manches des cours
const notation = stored('fb.notation', 'fr')
const bodyFinish = stored('fb.bodyFinish', undefined)

// ---------- Cours courant et progression ----------
const lessonId = ref(stored('fb.theory.lesson', ALL_LESSONS[0].id))
const done = ref(new Set(stored('fb.theory.done', [])))
const index = computed(() => Math.max(0, ALL_LESSONS.findIndex((l) => l.id === lessonId.value)))
const lesson = computed(() => ALL_LESSONS[index.value])
const prev = computed(() => ALL_LESSONS[index.value - 1] ?? null)
const next = computed(() => ALL_LESSONS[index.value + 1] ?? null)
const courseDone = (c) => c.lessons.filter((l) => done.value.has(l.id)).length
const progress = computed(() => Math.round((done.value.size / ALL_LESSONS.length) * 100))

watch(lessonId, (id) => {
  localStorage.setItem('fb.theory.lesson', JSON.stringify(id))
  window.scrollTo({ top: 0 })
})
function open(id) {
  lessonId.value = id
}
function finish() {
  done.value = new Set([...done.value, lesson.value.id])
  localStorage.setItem('fb.theory.done', JSON.stringify([...done.value]))
  if (next.value) open(next.value.id)
}

// ---------- Manches interactifs ----------
const PATTERNS = { scale: SCALES, arpeggio: ARPEGGIOS, chord: CHORDS }
function patternOf(ref_) {
  const [kind, id] = ref_.split(':')
  return PATTERNS[kind].find((p) => p.id === id)
}
function neckProps(b) {
  const pattern = patternOf(b.pattern)
  const frets = b.frets ?? 12
  const box = b.box ? scaleBoxes(b.root, pattern, STANDARD_TUNING, frets)[b.box - 1] : null
  return { overlay: buildOverlay(b.root, pattern), frets, focus: box?.keys ?? null, highlight: b.highlight ?? null, labelMode: b.labels ?? 'note' }
}
const played = reactive({}) // bloc -> note cliquée (affichée un instant)
let playId = 0
function playFret(key, n) {
  pluck([n.midi])
  const id = ++playId
  played[key] = { ...n, id }
  setTimeout(() => played[key]?.id === id && (played[key] = null), 900)
}

// ---------- Écoute ----------
const playing = ref(null)
function listen(key, item) {
  const seconds = pluck(item.notes, { chord: item.chord })
  playing.value = key
  setTimeout(() => playing.value === key && (playing.value = null), seconds * 1000)
}

// ---------- Quiz ----------
const answers = reactive({}) // bloc -> réponse choisie

// ---------- Pratiquer : ouvre le Manche réglé sur la gamme / l'accord du cours ----------
function practice(settings) {
  const s = { boxIndex: settings.box ?? 0, overlayType: settings.overlayType, root: settings.root }
  if (settings.scaleId) s.scaleId = settings.scaleId
  if (settings.arpeggioId) s.arpeggioId = settings.arpeggioId
  if (settings.chordId) s.chordId = settings.chordId
  // Le Manche n'est peut-être pas encore ouvert : il lira ces réglages à son ouverture
  Object.entries(s).forEach(([k, v]) => localStorage.setItem(`fb.${k}`, JSON.stringify(v)))
  practiceRequest.value = s
  document.documentElement.classList.add('page-leave')
  setTimeout(() => (location.hash = '#'), 220)
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-3.5rem)] bg-anthracite text-neutral-200">
    <!-- ========== Sommaire ========== -->
    <aside class="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-80 shrink-0 flex-col border-r border-white/5 bg-neutral-900/70 backdrop-blur lg:flex">
      <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <div>
          <div class="mb-2 flex items-baseline justify-between text-xs">
            <span class="font-semibold tracking-widest text-neutral-400 uppercase">Ta progression</span>
            <span class="text-neutral-500 tabular-nums">{{ done.size }} / {{ ALL_LESSONS.length }}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div class="h-full rounded-full bg-copper-500 transition-[width] duration-500" :style="{ width: progress + '%' }" />
          </div>
        </div>

        <section v-for="(c, ci) in COURSES" :key="c.id">
          <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-neutral-400 uppercase">
            <span class="flex size-5 items-center justify-center rounded-md bg-neutral-800 text-[10px] text-neutral-300">{{ ci + 1 }}</span>
            {{ c.title }}
            <span class="ml-auto font-normal tracking-normal text-neutral-600 tabular-nums">{{ courseDone(c) }}/{{ c.lessons.length }}</span>
          </h2>
          <ul class="space-y-0.5">
            <li v-for="l in c.lessons" :key="l.id">
              <button
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition"
                :class="l.id === lesson.id ? 'bg-white/8 font-semibold text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'"
                @click="open(l.id)"
              >
                <span class="flex size-4 shrink-0 items-center justify-center rounded-full" :class="done.has(l.id) ? 'bg-copper-500 text-neutral-950' : 'ring-1 ring-neutral-600'">
                  <Icon v-if="done.has(l.id)" name="check" class="size-3 stroke-[3]" />
                </span>
                <span class="min-w-0 flex-1 truncate">{{ l.title }}</span>
                <span class="text-[11px] text-neutral-600 tabular-nums">{{ l.minutes }} min</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </aside>

    <!-- ========== Cours ========== -->
    <main class="min-w-0 flex-1">
      <div class="px-4 pt-4 sm:px-8 lg:hidden">
        <!-- Sommaire en liste déroulante sur mobile -->
        <select :value="lesson.id" class="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm ring-1 ring-white/5 lg:hidden" aria-label="Cours" @change="open($event.target.value)">
          <optgroup v-for="c in COURSES" :key="c.id" :label="c.title">
            <option v-for="l in c.lessons" :key="l.id" :value="l.id">{{ done.has(l.id) ? '✓ ' : '' }}{{ l.title }}</option>
          </optgroup>
        </select>
      </div>

      <article :key="lesson.id" class="lesson mx-auto max-w-4xl px-4 pt-8 pb-20 sm:px-8">
        <header class="mb-8">
          <div class="text-xs font-bold tracking-[0.25em] text-copper-400 uppercase">{{ lesson.course.title }}</div>
          <h2 class="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{{ lesson.title }}</h2>
          <p class="mt-2 text-neutral-400">{{ lesson.summary }}</p>
          <div class="mt-3 flex items-center gap-3 text-xs text-neutral-500">
            <span class="rounded-full px-2.5 py-1 ring-1 ring-white/10">{{ lesson.minutes }} min</span>
            <span v-if="done.has(lesson.id)" class="flex items-center gap-1 text-copper-300"><Icon name="check" class="size-3.5" /> Terminé</span>
          </div>
        </header>

        <div class="space-y-6">
          <template v-for="(b, i) in lesson.blocks" :key="`${lesson.id}-${i}`">
            <p v-if="b.type === 'p'" class="prose-p" v-html="b.html" />

            <aside v-else-if="b.type === 'tip'" class="rounded-2xl bg-copper-500/10 p-4 ring-1 ring-copper-400/25 sm:p-5">
              <div class="mb-1 text-[11px] font-bold tracking-widest text-copper-300 uppercase">Astuce</div>
              <p class="prose-p" v-html="b.html" />
            </aside>

            <figure v-else-if="b.type === 'formula'">
              <div class="flex flex-wrap gap-1.5">
                <span v-for="(it, k) in b.items" :key="k" class="min-w-10 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-center text-sm font-bold text-neutral-100 ring-1 ring-white/5" :class="{ '!bg-copper-500/20 !text-copper-200': it === '½' }">{{ it }}</span>
              </div>
              <figcaption v-if="b.caption" class="mt-2 text-sm text-neutral-500">{{ b.caption }}</figcaption>
            </figure>

            <div v-else-if="b.type === 'table'" class="overflow-x-auto rounded-2xl ring-1 ring-white/8">
              <table class="w-full text-left text-sm">
                <thead class="bg-neutral-900 text-[11px] tracking-wider text-neutral-500 uppercase">
                  <tr><th v-for="h in b.head" :key="h" class="px-4 py-2.5 font-semibold whitespace-nowrap">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(r, k) in b.rows" :key="k" class="border-t border-white/5 odd:bg-white/[0.02]">
                    <td v-for="(cell, j) in r" :key="j" class="px-4 py-2" :class="j === 0 ? 'font-semibold whitespace-nowrap text-neutral-100' : 'text-neutral-400'">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <figure v-else-if="b.type === 'neck'" class="-mx-2 sm:-mx-6">
              <Fretboard
                :tuning="STANDARD_TUNING"
                :notation="notation"
                :body-finish="bodyFinish"
                v-bind="neckProps(b)"
                :played="played[`${lesson.id}-${i}`] ?? null"
                @play="playFret(`${lesson.id}-${i}`, $event)"
              />
              <figcaption class="mt-2 px-2 text-sm text-neutral-500 sm:px-6">{{ b.caption }}</figcaption>
            </figure>

            <div v-else-if="b.type === 'listen'" class="flex flex-wrap gap-2">
              <button
                v-for="(it, k) in b.items"
                :key="k"
                class="flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 transition"
                :class="playing === `${lesson.id}-${i}-${k}` ? 'bg-copper-500 text-white ring-copper-400' : 'bg-neutral-900 text-neutral-200 ring-white/10 hover:bg-neutral-800'"
                @click="listen(`${lesson.id}-${i}-${k}`, it)"
              >
                <Icon :name="playing === `${lesson.id}-${i}-${k}` ? 'volume' : 'play'" class="size-4" />
                {{ it.label }}
              </button>
            </div>

            <div v-else-if="b.type === 'feelings'" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div v-for="f in FEELINGS" :key="f.degree" class="flex gap-3 rounded-xl bg-neutral-900 p-3 ring-1 ring-white/5">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-black" :class="f.degree === '1' ? 'bg-copper-400 text-neutral-950' : 'bg-neutral-800 text-neutral-200'">{{ f.degree }}</span>
                <span class="min-w-0">
                  <span class="block font-bold text-neutral-100">{{ f.word }}</span>
                  <span class="block text-xs text-neutral-500">{{ f.sub }}</span>
                </span>
              </div>
            </div>

            <figure v-else-if="b.type === 'grid'">
              <div class="grid grid-cols-4 overflow-hidden rounded-2xl ring-1 ring-white/10">
                <div v-for="(bar, k) in b.bars" :key="k" class="relative border-white/10 py-4 text-center font-black text-neutral-100" :class="[k % 4 ? 'border-l' : '', k >= 4 ? 'border-t' : '', bar.startsWith('I7') ? 'bg-copper-500/10' : '']">
                  <span class="absolute top-1 left-2 text-[10px] font-semibold text-neutral-600">{{ k + 1 }}</span>
                  {{ bar }}
                </div>
              </div>
              <figcaption class="mt-2 text-sm text-neutral-500">{{ b.caption }}</figcaption>
            </figure>

            <div v-else-if="b.type === 'quiz'" class="rounded-2xl bg-neutral-900 p-4 ring-1 ring-white/8 sm:p-5">
              <div class="mb-1 text-[11px] font-bold tracking-widest text-neutral-500 uppercase">Quiz</div>
              <p class="font-semibold text-white">{{ b.question }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  v-for="(o, k) in b.options"
                  :key="k"
                  class="rounded-xl px-4 py-2 text-sm font-semibold ring-1 transition"
                  :class="
                    answers[`${lesson.id}-${i}`] === undefined
                      ? 'bg-neutral-800 text-neutral-200 ring-white/10 hover:bg-neutral-700'
                      : k === b.answer
                        ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/50'
                        : answers[`${lesson.id}-${i}`] === k
                          ? 'bg-rose-500/15 text-rose-200 ring-rose-400/40'
                          : 'bg-neutral-800/50 text-neutral-500 ring-white/5'
                  "
                  :disabled="answers[`${lesson.id}-${i}`] !== undefined"
                  @click="answers[`${lesson.id}-${i}`] = k"
                >
                  {{ o }}
                </button>
              </div>
              <p v-if="answers[`${lesson.id}-${i}`] !== undefined" class="mt-3 text-sm" :class="answers[`${lesson.id}-${i}`] === b.answer ? 'text-emerald-300' : 'text-rose-300'">
                {{ answers[`${lesson.id}-${i}`] === b.answer ? 'Bien joué !' : 'Pas tout à fait.' }}
                <span class="text-neutral-400">{{ b.explain }}</span>
              </p>
            </div>

            <div v-else-if="b.type === 'practice'" class="flex flex-col gap-4 rounded-2xl bg-neutral-900 p-4 ring-1 ring-copper-400/30 sm:flex-row sm:items-center sm:p-5">
              <div class="min-w-0 flex-1">
                <div class="mb-1 text-[11px] font-bold tracking-widest text-copper-300 uppercase">Exercice</div>
                <p class="prose-p" v-html="b.html" />
              </div>
              <button class="practice-btn shrink-0" @click="practice(b.settings)">Pratiquer sur le manche →</button>
            </div>
          </template>
        </div>

        <!-- Fin du cours -->
        <footer class="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-6">
          <button v-if="prev" class="text-sm font-semibold text-neutral-400 hover:text-white" @click="open(prev.id)">← {{ prev.title }}</button>
          <span v-else />
          <button class="practice-btn" @click="finish">
            {{ next ? `Terminé · ${next.title} →` : 'Terminé ✓' }}
          </button>
        </footer>
      </article>
    </main>
  </div>
</template>

<style scoped>
.prose-p {
  font-size: 15px;
  line-height: 1.75;
  color: #d6d3d1;
}
.prose-p :deep(b) {
  font-weight: 700;
  color: #fff;
}
.lesson {
  animation: lesson-in 0.35s ease both;
}
@keyframes lesson-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.practice-btn {
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(180deg, var(--color-copper-400), var(--color-copper-600));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    0 6px 20px -8px color-mix(in srgb, var(--color-copper-500) 70%, transparent);
  transition:
    transform 0.15s,
    filter 0.15s;
}
.practice-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
</style>
