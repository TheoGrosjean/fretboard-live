<script setup>
// Frise-tablature : une ligne par corde (Mi aigu en haut), chaque note à sa place dans le temps, avec son
// numéro de case. Au-dessus, une règle (mesures et temps) : y glisser délimite la section travaillée en boucle.
// En studio, une note se glisse dans le temps (horizontalement), d'une corde à l'autre (verticalement),
// et sa durée se règle par son bord droit. Pendant l'entraînement : résultat de chaque note, notes entendues,
// tête de lecture, décompte et retour au début de la boucle.
import { computed, inject, ref } from 'vue'
import { GRIDS, GRID_MIX, beatSubdivision, noteLength, powerShape, techOf } from '../../lib/phrases'
import { noteName } from '../../lib/music'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import Icon from '../Icon.vue'
import { beatLabel } from './format'

const s = inject(STUDIO_KEY)
const ROW = 22 // hauteur d'une corde (px)
const lanes = ref(null)

const L = computed(() => s.lengthBeats)
const pct = (beat) => (beat / L.value) * 100
const rows = computed(() => s.tuning.length)
const veil = computed(() => s.memoryShown >= 2) // de mémoire : le rythme seul, sans les cordes ni les cases
const inSection = (n) => s.mode !== 'practice' || (n.beat >= s.section.from - 1e-6 && n.beat < s.section.to - 1e-6)
const stringNames = computed(() => s.tuning.map((m) => noteName(m, s.notation)))

// ---------- Grille : mesures, temps, subdivisions (en grille mixte : celles des notes de chaque temps) ----------
const gridLines = computed(() => {
  const p = s.phrase
  if (!p) return []
  const grid = s.mode === 'record' && !s.punch ? s.metro.subdiv.value : p.grid
  const lines = []
  for (let k = 0; k < L.value; k++) {
    lines.push({ x: pct(k), kind: k % p.beats === 0 ? 'bar' : 'beat' })
    const fractions = s.shownNotes.filter((n) => n.beat >= k - 1e-6 && n.beat < k + 1 - 1e-6).map((n) => n.beat - k)
    const g = grid === GRID_MIX ? beatSubdivision(fractions, GRID_MIX) : grid
    for (let j = 1; j < g; j++) lines.push({ x: pct(k + j / g), kind: 'sub' })
  }
  return lines
})
const barLabels = computed(() => {
  const p = s.phrase
  if (!p) return []
  return Array.from({ length: Math.ceil(L.value / p.beats) }, (_, b) => ({ x: pct(b * p.beats), n: b + 1 }))
})

// ---------- Notes ----------
const heat = (rate) => (rate === null ? '' : rate >= 0.9 ? 'heat-good' : rate >= 0.6 ? 'heat-mid' : 'heat-bad')
const pills = computed(() => {
  const notes = s.shownNotes
  return notes.map((n, i) => {
    const state = s.noteState(i)
    const out = !inSection(n)
    const row = veil.value ? (rows.value - 1) / 2 : (n.string ?? 0)
    const len = noteLength(notes, i, L.value)
    const t = techOf(notes, i)
    const showLabel = !out && !(s.memoryShown >= 1 && (state === 'hidden' || state === 'idle'))
    return {
      i,
      n,
      left: pct(n.beat),
      width: pct(Math.max(len, 0.125)),
      top: row * ROW,
      state: out ? 'out' : state === 'hidden' ? 'veiled' : state,
      label: showLabel && !veil.value ? String(n.fret ?? '·') : '',
      name: noteName(n.midi, s.notation),
      tag: !veil.value && !out ? t?.tag : null,
      techState: s.techState(i),
      power: n.chord === 'power',
      heat: s.view === 'progress' && s.mode === 'idle' ? heat(s.profile[i]?.rate ?? null) : '',
    }
  })
})
// Power chord : la quinte et l'octave sur leurs cordes, au même moment (comme sur une tablature)
const ghosts = computed(() => {
  if (veil.value) return []
  return pills.value.flatMap((p) => {
    if (!p.power || p.n.string === undefined || p.state === 'out') return []
    return powerShape(p.n, s.tuning, s.frets).map((pos) => ({ key: `${p.i}-${pos.string}`, left: p.left, width: p.width, top: pos.string * ROW, label: p.label ? String(pos.fret) : '', state: p.state }))
  })
})
// Liés (arc + h / p), slides (trait penché), bends (flèche + amplitude) entre les notes
const techMarks = computed(() => {
  if (veil.value) return []
  const out = []
  const list = pills.value
  list.forEach((p, i) => {
    if (!p.tag || p.state === 'out') return
    const y = p.top + ROW / 2
    if (p.n.bend) return out.push({ key: i, kind: 'bend', x: p.left + Math.min(p.width * 0.7, pct(0.4)), y, label: p.tag.slice(1), state: p.techState })
    const prev = list[i - 1]
    if (!prev) return
    // De la fin de la note précédente au début de celle-ci : l'arc relie les deux notes sans les couvrir
    const x1 = prev.left + prev.width * 0.7
    const x2 = p.left + p.width * 0.3
    out.push({ key: i, kind: p.tag === 'h' || p.tag === 'p' ? 'arc' : 'slide', x1, x2, y1: prev.top + ROW / 2, y2: y, label: p.tag, state: p.techState })
  })
  return out
})

// Palm mutes : « P.M. » et un trait au-dessus des notes étouffées qui se suivent, comme sur une tablature
const pmSegments = computed(() => {
  if (veil.value) return []
  const out = []
  let seg = null
  pills.value.forEach((p) => {
    if (p.n.pm && p.state !== 'out') {
      if (seg && p.i === seg.last + 1) {
        seg.right = p.left + p.width
        seg.last = p.i
      } else out.push((seg = { key: p.i, left: p.left, right: p.left + p.width, last: p.i }))
    } else seg = null
  })
  return out
})

// ---------- Pendant l'entraînement ----------
const heardDots = computed(() => {
  const pass = s.shownPass
  if (s.mode !== 'practice' || !pass) return []
  return pass.events.map((e, k) => ({ k, x: pct(s.section.from + e.beat - pass.start), cls: e.ok ? 'ok' : e.echo ? 'echo' : 'ko' }))
})
const playhead = computed(() => (s.playheadBeat === null ? null : pct(s.playheadBeat)))
const band = computed(() => {
  const l = dragLoop.value ?? s.phrase?.loop
  return l ? { left: pct(Math.min(l.from, l.to)), width: pct(Math.abs(l.to - l.from)) } : null
})

// ---------- Glisser une note (studio) ----------
let drag = null
function beatsFromPx(px) {
  return (px / lanes.value.getBoundingClientRect().width) * L.value
}
function onPillDown(e, p) {
  if (!s.editable || p.state === 'out') return
  e.preventDefault()
  if (e.shiftKey) return s.extendSelection(p.i) // Maj + clic : plusieurs notes à la suite
  try {
    e.currentTarget.setPointerCapture(e.pointerId) // le glisser continue même si le pointeur sort de la note
  } catch {
    /* pointeur déjà relâché */
  }
  const n = s.phrase.notes[p.i]
  drag = { i: p.i, x: e.clientX, y: e.clientY, beat: n.beat, string: n.string, dur: noteLength(s.phrase.notes, p.i, s.phrase.lengthBeats), resize: !!e.target.closest('.grip'), moved: false, wasSelected: s.selectedNote === p.i }
  s.selectedNote = p.i
  s.beginDrag()
}
function onPillMove(e) {
  if (!drag) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  if (drag.resize) return s.dragTo(drag.i, { dur: drag.dur + beatsFromPx(dx) })
  const string = Math.min(rows.value - 1, Math.max(0, drag.string + Math.round(dy / ROW)))
  s.dragTo(drag.i, { beat: drag.beat + beatsFromPx(dx), string })
}
function onPillUp() {
  if (!drag) return
  const { moved, wasSelected } = drag
  drag = null
  s.endDrag(moved)
  if (!moved && wasSelected) s.selectedNote = null // second clic sur la note : désélection
}

// Double-clic sur une case vide de la tablature : une note à cette corde et à ce moment
function onLaneDblClick(e) {
  if (s.mode !== 'idle' || !s.phrase || e.target.closest('.pill')) return
  const r = e.currentTarget.getBoundingClientRect()
  const beat = ((e.clientX - r.left) / r.width) * L.value
  const string = Math.min(rows.value - 1, Math.max(0, Math.floor((e.clientY - r.top) / ROW)))
  s.addNote(beat, string)
}

// ---------- Règle : délimiter la section travaillée ----------
const dragLoop = ref(null)
let ruler = null
const snapHalf = (b) => Math.max(0, Math.min(L.value, Math.round(b * 2) / 2))
function rulerBeat(e) {
  const r = lanes.value.getBoundingClientRect()
  return snapHalf(((e.clientX - r.left) / r.width) * L.value)
}
function onRulerDown(e) {
  if (!s.phrase?.notes.length || s.mode === 'record' || s.mode === 'free') return
  e.preventDefault()
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* pointeur déjà relâché */
  }
  ruler = { from: rulerBeat(e), moved: false }
  dragLoop.value = null
}
const hoverBeat = ref(null)
const beatTicks = computed(() => {
  const p = s.phrase
  if (!p) return []
  return Array.from({ length: Math.ceil(L.value) + 1 }, (_, k) => ({ k, x: pct(k), bar: k % p.beats === 0 }))
})
function onRulerMove(e) {
  hoverBeat.value = rulerBeat(e)
  if (!ruler) return
  const to = rulerBeat(e)
  if (to !== ruler.from) ruler.moved = true
  if (ruler.moved) dragLoop.value = { from: ruler.from, to }
}
function onRulerUp() {
  if (!ruler) return
  if (ruler.moved && dragLoop.value) s.setLoop(dragLoop.value.from, dragLoop.value.to)
  else if (s.mode === 'idle') s.clearLoop() // un clic sans glisser retire la boucle
  ruler = null
  dragLoop.value = null
}
const loopLabel = computed(() => {
  const l = s.phrase?.loop
  return l ? `${beatLabel(l.from, s.phrase.beats)} → ${beatLabel(l.to, s.phrase.beats)}` : ''
})
</script>

<template>
  <div class="rail-wrap rounded-2xl px-4 pt-3 pb-4 ring-1 ring-white/5">
    <!-- En-tête : outils du studio, ou section travaillée -->
    <div class="mb-2 flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">
      <span>Tablature</span>
      <div v-if="s.editable && s.view === 'studio'" class="flex flex-wrap items-center gap-1.5 tracking-normal normal-case">
        <select :value="s.phrase.grid" class="tool" title="Grille : replace les notes sur une autre subdivision (Mixte : chaque temps la sienne)" @change="s.changeGrid(Number($event.target.value))">
          <option v-for="g in GRIDS" :key="g.n" :value="g.n">Grille : {{ g.name.toLowerCase() }}</option>
        </select>
        <span class="flex items-center">
          <button class="tool rounded-r-none" title="Tout décaler d'une case vers la gauche (Maj + ←)" @click="s.shiftPhrase(-1)">◀</button>
          <span class="tool pointer-events-none rounded-none border-x border-white/5 text-neutral-400">Tout décaler</span>
          <button class="tool rounded-l-none" title="Tout décaler d'une case vers la droite (Maj + →)" @click="s.shiftPhrase(1)">▶</button>
        </span>
        <button class="tool is-accent" title="Retrouve ton décalage moyen et recale toutes les notes sur la grille" @click="s.runAutoAlign">Calage auto</button>
        <span class="flex items-center">
          <button class="tool rounded-r-none" :disabled="!s.past.length" :title="s.past.length ? `Annuler : ${s.past.at(-1).label} (⌘Z)` : 'Rien à annuler'" @click="s.undo">↶</button>
          <button class="tool rounded-l-none border-l border-white/5" :disabled="!s.future.length" :title="s.future.length ? `Rétablir : ${s.future.at(-1).label} (⇧⌘Z)` : 'Rien à rétablir'" @click="s.redo">↷</button>
        </span>
      </div>
      <span class="flex-1" />
      <button v-if="s.phrase?.notes.length && s.mode === 'idle'" class="text-[11px] tracking-normal text-neutral-500 normal-case hover:text-neutral-200" title="Sélectionner tout le phrasé" @click="s.selectAll">Tout sélectionner</button>
      <span v-if="s.phrase?.loop" class="loop-chip">
        <Icon name="repeat" class="size-3.5" />
        Boucle {{ loopLabel }}
        <button class="ml-1 text-copper-300/70 hover:text-white" title="Retirer la boucle" :disabled="s.mode === 'practice'" @click="s.clearLoop">✕</button>
      </span>

    </div>

    <div class="flex items-stretch gap-3">
      <!-- Décompte, à côté de la frise : mesure de départ, puis temps restants avant le retour au début -->
      <div v-if="s.mode === 'practice' || s.mode === 'record'" class="loop-badge" :class="{ on: s.counting || s.loopEdge?.soon, flash: s.loopEdge?.restart }" :title="s.counting ? 'Décompte' : 'Retour au début de la boucle'">
        <Transition name="tick" mode="out-in">
          <span v-if="s.counting" :key="'c' + s.countdown" class="text-3xl font-black">{{ s.countdown }}</span>
          <span v-else-if="s.loopEdge?.count" :key="'r' + s.loopEdge.count" class="flex items-baseline gap-0.5"><span class="text-base">↺</span><span class="text-3xl font-black">{{ s.loopEdge.count }}</span></span>
          <span v-else key="loop" class="text-2xl">↺</span>
        </Transition>
      </div>

      <!-- Noms des cordes -->
      <div class="flex shrink-0 flex-col pt-11 text-right text-[10px] leading-none font-semibold text-neutral-600" :class="{ 'opacity-0': veil }">
        <span v-for="(n, k) in stringNames" :key="k" class="flex items-center justify-end" :style="{ height: ROW + 'px' }">{{ n }}</span>
      </div>

      <div ref="lanes" class="relative min-w-0 flex-1" :class="{ editable: s.editable }">
        <!-- Règle : mesures ; glisser = section en boucle -->
        <!-- Règle : mesures et temps ; glisser = sélection (boucle d'entraînement, motif à copier) -->
        <div
          class="ruler relative h-8 cursor-col-resize select-none"
          :class="{ usable: s.phrase?.notes.length && (s.mode === 'idle' || s.mode === 'practice') }"
          title="Glisse pour sélectionner des temps : boucle d'entraînement, motif à copier ou répéter. Un clic retire la sélection."
          @pointerdown="onRulerDown"
          @pointermove="onRulerMove"
          @pointerup="onRulerUp"
          @pointercancel="onRulerUp"
          @pointerleave="hoverBeat = null"
        >
          <span v-for="t in beatTicks" :key="'b' + t.k" class="beat-tick" :class="{ bar: t.bar }" :style="{ left: t.x + '%' }" />
          <span v-for="b in barLabels" :key="b.n" class="bar-num" :style="{ left: b.x + '%' }">{{ b.n }}</span>
          <span v-if="hoverBeat !== null && !ruler" class="ruler-hover" :style="{ left: pct(hoverBeat) + '%' }" />
          <span v-if="!s.phrase?.loop && !dragLoop && s.phrase?.notes.length && s.mode === 'idle'" class="ruler-hint">⟷ glisse ici pour sélectionner des temps</span>
        </div>

        <div class="relative" :style="{ height: rows * ROW + 'px' }" :title="s.mode === 'idle' && s.phrase ? 'Double-clic sur une case vide : ajouter une note' : undefined" @dblclick="onLaneDblClick">
          <!-- Cordes -->
          <span v-for="k in rows" :key="'s' + k" class="string-line" :style="{ top: (k - 0.5) * ROW + 'px' }" />
          <!-- Grille -->
          <span v-for="(l, k) in gridLines" :key="'g' + k" class="grid-line" :class="l.kind" :style="{ left: l.x + '%' }" />
          <!-- Section en boucle -->
          <span v-if="band" class="loop-band" :style="{ left: band.left + '%', width: band.width + '%' }" />

          <!-- Techniques -->
          <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" :viewBox="`0 0 100 ${rows * ROW}`" preserveAspectRatio="none">
            <template v-for="t in techMarks" :key="t.key">
              <path v-if="t.kind === 'arc'" :d="`M ${t.x1} ${t.y1 - 8} Q ${(t.x1 + t.x2) / 2} ${Math.min(t.y1, t.y2) - 17} ${t.x2} ${t.y2 - 8}`" class="tech-line" :class="`is-${t.state}`" vector-effect="non-scaling-stroke" />
              <line v-else-if="t.kind === 'slide'" :x1="t.x1" :x2="t.x2" :y1="t.y1 + (t.label === '/' ? 5 : -5)" :y2="t.y2 + (t.label === '/' ? -5 : 5)" class="tech-line slide" :class="`is-${t.state}`" vector-effect="non-scaling-stroke" />
            </template>
          </svg>
          <template v-for="t in techMarks" :key="'l' + t.key">
            <span v-if="t.kind === 'arc'" class="tech-label" :class="`is-${t.state}`" :style="{ left: (t.x1 + t.x2) / 2 + '%', top: Math.min(t.y1, t.y2) - 21 + 'px' }">{{ t.label }}</span>
            <span v-else-if="t.kind === 'bend'" class="bend-mark" :class="`is-${t.state}`" :style="{ left: t.x + '%', top: t.y - 25 + 'px' }">↑{{ t.label }}</span>
          </template>

          <!-- Palm mutes -->
          <span v-for="g in pmSegments" :key="'pm' + g.key" class="pm-mark" :style="{ left: g.left + '%', width: g.right - g.left + '%' }">P.M.</span>
          <!-- Power chords : quinte et octave -->
          <span v-for="g in ghosts" :key="g.key" class="ghost" :class="`is-${g.state}`" :style="{ left: `calc(${g.left}% + 1px)`, width: `calc(${g.width}% - 2px)`, top: g.top + 2 + 'px' }">{{ g.label }}</span>

          <!-- Notes -->
          <button
            v-for="p in pills"
            :key="p.i"
            class="pill"
            :class="[`is-${p.state}`, p.heat, { power: p.power }]"
            :style="{ left: `calc(${p.left}% + 1px)`, width: `calc(${p.width}% - 2px)`, top: p.top + 2 + 'px', height: ROW - 4 + 'px' }"
            :title="`Note ${p.i + 1} · ${p.name}${p.n.string !== undefined ? ` · corde ${p.n.string + 1}, case ${p.n.fret}` : ''}${s.editable ? ' — glisse : temps ↔, corde ↕ · Maj + clic : sélectionner jusqu’ici · double-clic : écouter' : ''}`"
            @pointerdown="onPillDown($event, p)"
            @pointermove="onPillMove"
            @pointerup="onPillUp"
            @pointercancel="onPillUp"
            @dblclick="s.editable && s.previewNote(p.n)"
            @click="!s.editable && s.mode === 'idle' && s.selectNote(p.i)"
          >
            <span v-if="p.tag && p.tag !== 'h' && p.tag !== 'p' && !p.n.bend" class="tech-tag" :class="`is-${p.techState}`">{{ p.tag }}</span>
            {{ p.label }}
            <span v-if="s.editable" class="grip" title="Tire pour changer la durée" />
          </button>

          <!-- Ce que l'app a entendu : vert = note reconnue, rouge = en trop, gris = écho ignoré -->
          <span v-for="h in heardDots" :key="'h' + h.k" class="heard" :class="h.cls" :style="{ left: h.x + '%' }" />

          <span v-if="!s.shownNotes.length" class="absolute inset-0 flex items-center justify-center text-sm text-neutral-600">
            {{ s.mode === 'record' ? (s.counting ? 'Prépare-toi…' : 'Joue : les notes apparaissent ici') : s.mode === 'free' ? 'Joue : la prise est analysée à la fin' : 'Les notes de ton phrasé apparaîtront ici' }}
          </span>
        </div>

        <!-- Saisie au manche : où ira la prochaine note -->
        <span v-if="s.entry" class="entry-cursor" :style="{ left: pct(Math.min(s.entry.beat, L)) + '%' }" />
        <!-- Tête de lecture et bords de boucle (sur toute la hauteur) -->
        <span v-if="playhead !== null" class="playhead" :style="{ left: playhead + '%' }" />
        <template v-if="s.loopEdge">
          <span class="edge edge-right" :class="{ on: s.loopEdge.soon }" />
          <span :key="s.loopEdge.restart ? 'flash' : 'idle'" class="edge edge-left" :class="{ on: s.loopEdge.soon, flash: s.loopEdge.restart }" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../../style.css";

.rail-wrap {
  background: #141211;
}
.tool {
  @apply flex h-7 items-center rounded-lg bg-neutral-800 px-2.5 text-xs font-semibold text-neutral-300 ring-1 ring-white/10 transition outline-none hover:bg-neutral-700 hover:text-white disabled:opacity-35 disabled:hover:bg-neutral-800;
}
.tool.is-accent {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40 hover:bg-copper-500/25;
}
.loop-chip {
  @apply flex items-center gap-1.5 rounded-full bg-copper-500/15 px-2.5 py-1 text-[11px] tracking-normal text-copper-300 normal-case ring-1 ring-copper-400/40;
}

/* ---------- Règle, cordes, grille ---------- */
.ruler {
  @apply mb-3 rounded-md bg-white/[0.04] ring-1 ring-white/10;
}
.ruler.usable:hover {
  @apply bg-copper-500/10 ring-copper-400/40;
}
.beat-tick {
  @apply pointer-events-none absolute bottom-0 h-2 w-px bg-white/20;
}
.beat-tick.bar {
  @apply h-full bg-white/35;
}
.bar-num {
  @apply pointer-events-none absolute top-1.5 pl-1.5 text-[11px] font-black text-neutral-300 tabular-nums;
}
.ruler-hover {
  @apply pointer-events-none absolute inset-y-0 w-0.5 bg-copper-400/70;
}
.ruler-hint {
  @apply pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-neutral-500;
}
.string-line {
  @apply pointer-events-none absolute inset-x-0 h-px bg-white/[0.07];
}
.grid-line {
  @apply pointer-events-none absolute inset-y-0 w-px;
}
.grid-line.bar {
  @apply bg-white/25;
}
.grid-line.beat {
  @apply bg-white/10;
}
.grid-line.sub {
  @apply bg-white/[0.04];
}
.loop-band {
  @apply pointer-events-none absolute -top-11 bottom-0 rounded-md bg-copper-500/15 ring-1 ring-copper-400/60;
}

/* ---------- Notes ---------- */
.pill {
  @apply absolute flex min-w-5 items-center justify-center gap-px overflow-hidden rounded-md px-1 text-[11px] leading-none font-black whitespace-nowrap text-white ring-1 transition-colors duration-100;
  @apply bg-neutral-800 ring-copper-400/50;
}
.pill.is-selected {
  @apply z-10 bg-stone-50 text-neutral-900 ring-2 ring-copper-400;
}
.pill.is-next {
  @apply z-10 bg-copper-500 ring-2 ring-white shadow-[0_0_16px] shadow-copper-500/70;
}
.pill.is-soon {
  @apply bg-neutral-800 ring-2 ring-copper-300/80;
}
.pill.is-hit {
  @apply bg-emerald-600 ring-emerald-400;
}
.pill.is-miss {
  @apply bg-rose-600 ring-rose-400;
}
.pill.is-veiled {
  @apply bg-neutral-800/70 ring-white/10;
}
.pill.is-out {
  @apply bg-neutral-900 text-neutral-600 ring-white/5;
}
.pill.heat-good {
  @apply ring-emerald-400/60;
}
.pill.heat-mid {
  @apply bg-amber-500/25 ring-amber-400/70;
}
.pill.heat-bad {
  @apply bg-rose-500/30 ring-rose-400/80;
}
.pm-mark {
  @apply pointer-events-none absolute -top-3 flex h-2.5 items-center border-t border-dashed border-neutral-400/70 pt-1.5 text-[8px] leading-none font-black tracking-wider text-neutral-400;
}
.ghost {
  @apply pointer-events-none absolute flex items-center justify-center rounded-md border border-dashed border-copper-400/40 text-[10px] leading-none font-bold text-copper-300/80;
  height: 18px;
}
.tech-tag {
  @apply absolute top-px left-0.5 text-[8px] leading-none font-black text-copper-300;
}
.pill.is-next .tech-tag,
.pill.is-hit .tech-tag,
.pill.is-miss .tech-tag {
  @apply text-white/90;
}
.pill.is-selected .tech-tag {
  @apply text-copper-600;
}
.grip {
  @apply absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md bg-white/0 transition hover:bg-white/25;
}
.pill:hover .grip {
  @apply bg-white/10;
}
.editable .pill {
  @apply cursor-grab touch-none active:cursor-grabbing;
}

/* ---------- Techniques ---------- */
.tech-line {
  fill: none;
  stroke: var(--color-copper-400);
  stroke-width: 1.6;
  stroke-linecap: round;
}
.tech-line.slide {
  stroke-width: 2.2;
}
.tech-line.is-ok {
  stroke: #34d399;
}
.tech-line.is-miss {
  stroke: #fbbf24;
}
.tech-label {
  @apply pointer-events-none absolute -translate-x-1/2 text-[10px] leading-none font-black text-copper-300;
}
.bend-mark {
  @apply pointer-events-none absolute -translate-x-1/2 text-[10px] leading-none font-black whitespace-nowrap text-copper-300;
}
.tech-label.is-ok,
.bend-mark.is-ok {
  @apply text-emerald-300;
}
.tech-label.is-miss,
.bend-mark.is-miss {
  @apply text-amber-300;
}

/* ---------- Entraînement ---------- */
.heard {
  @apply pointer-events-none absolute -bottom-1 size-2 -translate-x-1/2 rounded-full ring-2 ring-neutral-950;
}
.heard.ok {
  @apply bg-emerald-400;
}
.heard.ko {
  @apply bg-rose-400;
}
.heard.echo {
  @apply bg-neutral-500;
}
.entry-cursor {
  @apply pointer-events-none absolute top-11 -bottom-1 z-20 w-0.5 animate-pulse rounded bg-copper-400 shadow-[0_0_10px] shadow-copper-400/70;
}
.playhead {
  @apply pointer-events-none absolute -top-0.5 -bottom-1 z-20 w-0.5 rounded bg-white shadow-[0_0_10px] shadow-white/70;
}
.edge {
  @apply pointer-events-none absolute top-11 -bottom-1 w-16 opacity-0 transition-opacity duration-300;
}
.edge.on {
  @apply opacity-100;
}
.edge-right {
  @apply right-0 rounded-r-xl;
  background: linear-gradient(to left, rgba(240, 149, 106, 0.35), transparent);
}
.edge-left {
  @apply left-0 rounded-l-xl;
  background: linear-gradient(to right, rgba(240, 149, 106, 0.45), transparent);
}
.edge-left.on {
  animation: edge-call 0.6s ease-in-out infinite alternate;
}
/* La tête vient de repartir : éclair au bord gauche */
.edge-left.flash {
  opacity: 1;
  animation: edge-flash 0.5s ease-out forwards;
}
.loop-badge {
  @apply flex w-16 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-neutral-600 tabular-nums ring-1 ring-white/5 transition-colors duration-200;
}
.loop-badge.on {
  @apply bg-copper-500/20 text-copper-300 ring-copper-400/50;
}
.loop-badge.flash {
  @apply bg-copper-500 text-white;
}
.tick-enter-active {
  transition: all 0.18s cubic-bezier(0.2, 1.5, 0.4, 1);
}
.tick-leave-active {
  transition: all 0.08s ease-in;
}
.tick-enter-from {
  opacity: 0;
  transform: scale(1.5);
}
.tick-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
@keyframes edge-call {
  from {
    opacity: 0.45;
  }
  to {
    opacity: 1;
  }
}
@keyframes edge-flash {
  from {
    opacity: 1;
    box-shadow: inset 6px 0 18px -4px rgba(255, 255, 255, 0.9);
  }
  to {
    opacity: 0;
    box-shadow: inset 0 0 0 0 rgba(255, 255, 255, 0);
  }
}
</style>
