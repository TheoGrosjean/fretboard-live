<script setup>
// Studio : enregistrer (sur le clic, en prise libre, ou une section seulement), puis retoucher le phrasé
// (doigté, transposition) et la note sélectionnée (technique, power chord).
import { computed, inject } from 'vue'
import { STUDIO_KEY } from '../../composables/usePhraseStudio'
import { ZONES, bendLabel, noteLength } from '../../lib/phrases'
import { noteName } from '../../lib/music'
import { beatLabel, durationLabel } from './format'

const s = inject(STUDIO_KEY)
const recording = computed(() => s.mode === 'record')
const free = computed(() => s.mode === 'free')
const busy = computed(() => s.mode === 'practice' || s.mode === 'listen' || s.mode === 'calibrate')
const freeSeconds = computed(() => (free.value ? Math.floor((s.clock - s.freeStart) / 1000) : 0))
const sel = computed(() => s.selected)
const selDur = computed(() => (sel.value ? noteLength(s.phrase.notes, s.selectedNote, s.phrase.lengthBeats) : 0))
const hasLocked = computed(() => s.phrase?.notes.some((n) => n.locked))
const loopText = computed(() => (s.phrase?.loop ? `${beatLabel(s.phrase.loop.from, s.phrase.beats)} → ${beatLabel(s.phrase.loop.to, s.phrase.beats)}` : ''))
const confidence = computed(() => (s.freeResult ? Math.round(s.freeResult.confidence * 100) : 0))
</script>

<template>
  <section class="panel">
    <!-- Enregistrer -->
    <div class="panel-title">Enregistrer</div>
    <div class="grid gap-3 sm:grid-cols-2">
      <button class="take-card" :class="{ on: recording }" :disabled="busy || free" @click="recording ? s.stopAll() : s.startRecording()">
        <span class="take-icon bg-rose-500/15"><span class="rec-dot" :class="{ 'animate-pulse': recording }" /></span>
        <span class="min-w-0">
          <b>{{ recording ? (s.punch ? 'Terminer la section' : 'Terminer la prise') : 'Sur le clic' }}</b>
          <small>Une mesure de décompte, puis joue : chaque note se cale sur la grille du métronome. <kbd>R</kbd></small>
        </span>
      </button>
      <button class="take-card" :class="{ on: free }" :disabled="busy || recording" @click="free ? s.stopAll() : s.startFreeTake()">
        <span class="take-icon bg-copper-500/15 text-copper-300">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 14c2.5 0 2.5-6 5-6s2.5 8 5 8 2.5-10 5-10 2 4 3 4" /></svg>
        </span>
        <span class="min-w-0">
          <b>{{ free ? 'Terminer la prise libre' : 'Prise libre' }}</b>
          <small>Sans clic, à ton tempo : l’app retrouve elle-même le tempo et le rythme. <kbd>L</kbd></small>
        </span>
      </button>
    </div>
    <!-- Écrire à la main : clic sur le manche -->
    <div class="entry-card" :class="{ on: s.entry }">
      <button class="flex min-w-0 flex-1 items-center gap-3 text-left" :disabled="busy || recording || free" @click="s.toggleEntry">
        <span class="take-icon bg-white/5 text-neutral-300">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
        </span>
        <span class="min-w-0">
          <b>{{ s.entry ? 'Saisie au manche : clique les cases' : 'Écrire à la main' }}</b>
          <small>{{ s.entry ? 'Chaque case cliquée ajoute la note suivante. ⌫ retire la dernière, Échap termine.' : 'Sans jouer : clique les notes sur le manche, une par une, comme dans un éditeur de tablature.' }}</small>
        </span>
      </button>
      <template v-if="s.entry">
        <div class="flex items-center gap-1.5 text-xs">
          <span class="text-neutral-500">Durée</span>
          <div class="seg">
            <button v-for="d in [0.25, 1 / 3, 0.5, 1, 2]" :key="d" :class="{ on: Math.abs(s.entry.dur - d) < 1e-6 }" @click="s.entry.dur = d">{{ durationLabel(d).replace(' temps', '') }}</button>
          </div>
          <button class="tool" title="Avancer d'une durée sans note" @click="s.entryRest">Silence</button>
          <button class="tool" :disabled="!s.entry.ids.length" title="Retirer la dernière note saisie (⌫)" @click="s.entryBack">⌫</button>
          <button class="tool is-accent" @click="s.toggleEntry">Terminer</button>
        </div>
      </template>
    </div>
    <button v-if="s.phrase?.loop && s.phrase.notes.length && !recording && !free" class="punch-btn" :disabled="busy" title="Un décompte, puis rejoue seulement cette section : le reste du phrasé ne bouge pas" @click="s.startPunch">
      ↻ Réenregistrer seulement la section {{ loopText }}
    </button>

    <!-- Prise libre en cours -->
    <div v-if="free" class="free-live">
      <span class="rec-dot animate-pulse" />
      <span><b class="text-white">{{ s.freeCount }}</b> note{{ s.freeCount > 1 ? 's' : '' }} · {{ freeSeconds }} s</span>
      <span class="text-neutral-500">Joue ton phrasé à ton tempo. Trois secondes de silence terminent la prise.</span>
    </div>

    <!-- Résultat de la prise libre : tempo trouvé, autres lectures -->
    <div v-else-if="s.freeResult && s.mode === 'idle'" class="free-result">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="text-neutral-400">Tempo retrouvé</span>
        <b class="text-2xl text-white">{{ s.freeResult.bpm }} BPM</b>
        <span class="text-neutral-400">en {{ s.freeResult.feel }}</span>
        <span class="ml-auto text-xs" :class="confidence >= 70 ? 'text-emerald-300' : confidence >= 45 ? 'text-amber-300' : 'text-rose-300'" :title="`Écart moyen des notes à la grille : ${s.freeResult.errorMs} ms`">fiabilité {{ confidence }} %</span>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-neutral-500">Pas ça ?</span>
        <button v-for="a in s.freeResult.alternatives" :key="a.bpm" class="tool" @click="s.reinterpret(a.bpm)">{{ a.bpm }} BPM · {{ a.feel }}</button>
        <button class="tool" title="Tempo deux fois plus lent" @click="s.reinterpret(s.freeResult.bpm / 2)">÷ 2</button>
        <button class="tool" title="Tempo deux fois plus rapide" @click="s.reinterpret(s.freeResult.bpm * 2)">× 2</button>
      </div>
    </div>

    <!-- Retoucher le phrasé -->
    <template v-if="s.phrase?.notes.length">
      <div class="panel-title mt-5">Retoucher</div>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
        <label class="flex items-center gap-2 text-neutral-400">
          Doigté
          <select :value="String(s.phrase.zone)" class="tool" :disabled="!s.editable" title="Zone du manche où garder la main" @change="s.setZone($event.target.value === 'null' ? null : Number($event.target.value))">
            <option v-for="z in ZONES" :key="String(z.fret)" :value="String(z.fret)">{{ z.label }}</option>
          </select>
          <button v-if="hasLocked" class="tool" :disabled="!s.editable" title="Les notes placées à la main reviennent au doigté automatique" @click="s.autoPlace">Tout replacer</button>
        </label>
        <span class="flex items-center gap-1.5 text-neutral-400">
          Transposer
          <span class="flex items-center">
            <button class="tool rounded-r-none" :disabled="!s.editable" title="Un demi-ton plus bas" @click="s.transposePhrase(-1)">−½</button>
            <button class="tool rounded-none border-x border-white/5" :disabled="!s.editable" title="Un demi-ton plus haut" @click="s.transposePhrase(1)">+½</button>
            <button class="tool rounded-none border-r border-white/5" :disabled="!s.editable" title="Une octave plus bas" @click="s.transposePhrase(-12)">−8ve</button>
            <button class="tool rounded-l-none" :disabled="!s.editable" title="Une octave plus haut" @click="s.transposePhrase(12)">+8ve</button>
          </span>
        </span>
      </div>
      <!-- Motifs : la section délimitée sur la règle -->
      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-400">
        <span>Motif</span>
        <template v-if="s.phrase.loop">
          <span class="text-copper-300">{{ loopText }}</span>
          <button class="tool" :disabled="!s.editable" title="Copier la section (⌘C)" @click="s.copySection">Copier</button>
          <span class="flex items-center">
            <button class="tool rounded-r-none" :disabled="!s.editable" title="Répéter la section juste après elle" @click="s.repeatSection(1)">Répéter</button>
            <button class="tool rounded-none border-x border-white/5" :disabled="!s.editable" @click="s.repeatSection(2)">×2</button>
            <button class="tool rounded-l-none" :disabled="!s.editable" @click="s.repeatSection(3)">×3</button>
          </span>
        </template>
        <span v-else class="text-neutral-600">glisse sur la règle de la tablature pour choisir les notes à copier ou répéter</span>
        <button v-if="s.clipboard" class="tool is-accent" :disabled="s.mode !== 'idle'" :title="`Coller ${s.clipboard.notes.length} note(s) ${s.entry ? 'au curseur' : s.selected ? 'après la note sélectionnée' : 'à la fin du phrasé'} (⌘V)`" @click="s.pasteClip">Coller {{ s.entry ? 'au curseur' : s.selected ? 'après la note' : 'à la fin' }}</button>
      </div>

      <p v-if="s.alignInfo && s.editable" class="mt-3 text-xs text-neutral-400">
        {{ s.alignInfo }}
        <button v-if="Math.abs(s.lastAlignMs) >= 8 && s.latency + s.lastAlignMs >= 0" class="ml-2 font-semibold text-copper-300 hover:text-copper-400" @click="s.applyToLatency">
          {{ s.lastAlignMs > 0 ? 'Ajouter' : 'Retirer' }} {{ Math.abs(s.lastAlignMs) }} ms au calage pour les prochaines prises
        </button>
      </p>

      <!-- Note sélectionnée -->
      <div v-if="sel && s.editable" class="inspector">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-xs font-semibold text-neutral-500">Note {{ s.selectedNote + 1 }}</span>
          <b class="text-xl text-white">{{ noteName(sel.midi, s.notation, true) }}{{ sel.chord === 'power' ? '5' : '' }}</b>
          <span class="text-sm text-neutral-400">corde {{ sel.string + 1 }}, case {{ sel.fret }}</span>
          <span class="text-sm text-neutral-500">· mesure {{ beatLabel(sel.beat, s.phrase.beats) }} · {{ durationLabel(selDur) }}</span>
          <span class="ml-auto flex gap-1.5">
            <span class="flex items-center">
              <button class="tool rounded-r-none" title="Un demi-ton plus bas" @click="s.shiftPitch(-1)">−½</button>
              <button class="tool rounded-none border-x border-white/5" title="Un demi-ton plus haut" @click="s.shiftPitch(1)">+½</button>
              <button class="tool rounded-none border-r border-white/5" title="Une octave plus bas" @click="s.shiftPitch(-12)">−8ve</button>
              <button class="tool rounded-l-none" title="Une octave plus haut" @click="s.shiftPitch(12)">+8ve</button>
            </span>
            <button class="tool" title="Ajouter une note juste après" @click="s.addNoteAfter">＋ Note</button>
            <button class="tool" title="Écouter la note" @click="s.previewNote(sel)">▶ Écouter</button>
            <button class="tool text-rose-300" title="Supprimer la note (Suppr)" @click="s.deleteNote">Supprimer</button>
          </span>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span class="mr-1 font-semibold tracking-widest text-neutral-500 uppercase">Technique</span>
          <button class="tool" :class="{ 'is-accent': !s.selTech }" @click="s.setTech(null)">Aucune</button>
          <button class="tool" :class="{ 'is-accent': s.selTech === 'legato' }" :disabled="!s.selectedNote" :title="s.selectedNote ? 'Hammer-on si la note monte, pull-off si elle descend' : 'Il faut une note avant'" @click="s.setTech('legato')">{{ s.legatoName }}</button>
          <button class="tool" :class="{ 'is-accent': s.selTech === 'slide' }" :disabled="!s.selectedNote" @click="s.setTech('slide')">Slide</button>
          <button v-for="b in [1, 2, 3]" :key="b" class="tool" :class="{ 'is-accent': sel.bend === b }" @click="s.setTech('bend', b)">Bend {{ bendLabel(b) }}</button>
          <button v-if="sel.bend" class="tool" :class="{ 'is-accent': sel.release }" title="Le bend redescend à la note de départ" @click="s.toggleRelease">Relâché</button>
          <button class="tool" :class="{ 'is-accent': sel.pm }" title="Note étouffée avec la paume (repérée automatiquement à l'enregistrement)" @click="s.togglePalmMute">Palm mute</button>
          <span class="mx-1 h-4 w-px bg-white/10" />
          <button class="tool" :class="{ 'is-accent': sel.chord === 'power' }" title="Fondamentale + quinte (+ octave)" @click="s.togglePower">Power chord</button>
        </div>
        <p class="mt-2 text-[11px] text-neutral-600">Clique une case du manche pour changer la note · ← → : la déplacer d'une case · glisse-la sur la tablature (temps ↔, corde ↕)</p>
      </div>
      <p v-else-if="s.editable" class="mt-4 flex flex-wrap items-center gap-3 text-xs text-neutral-600">
        Clique une note, sur la tablature ou sur le manche, pour la modifier. Double-clic sur une case vide de la tablature : ajouter une note.
        <button class="tool" @click="s.addNoteAfter">＋ Ajouter une note</button>
      </p>
    </template>
  </section>
</template>

<style scoped>
@reference "../../style.css";

.panel {
  @apply rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5;
}
.panel-title {
  @apply mb-3 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.take-card {
  @apply flex items-start gap-3 rounded-xl bg-white/[0.03] p-3.5 text-left ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:ring-white/20 disabled:opacity-40 disabled:hover:bg-white/[0.03];
}
.take-card b {
  @apply block text-sm font-bold text-neutral-100;
}
.take-card small {
  @apply mt-0.5 block text-xs leading-snug text-neutral-500;
}
.take-card.on {
  @apply bg-rose-600/15 ring-rose-400/60;
}
.take-icon {
  @apply flex size-10 shrink-0 items-center justify-center rounded-xl;
}
.rec-dot {
  @apply size-3 rounded-full bg-rose-500;
}
kbd {
  @apply ml-1 rounded bg-neutral-800 px-1 font-sans text-[10px] font-semibold text-neutral-300 ring-1 ring-white/10;
}
.entry-card {
  @apply mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/10 transition;
}
.entry-card.on {
  @apply bg-copper-500/10 ring-copper-400/50;
}
.entry-card b {
  @apply block text-sm font-bold text-neutral-100;
}
.entry-card small {
  @apply mt-0.5 block text-xs leading-snug text-neutral-500;
}
.seg {
  @apply flex rounded-lg bg-neutral-800 p-0.5;
}
.seg button {
  @apply rounded-md px-2 py-1 font-bold text-neutral-400 hover:text-white;
}
.seg button.on {
  @apply bg-copper-500 text-white;
}
.punch-btn {
  @apply mt-3 w-full rounded-xl border border-dashed border-copper-400/40 px-3 py-2 text-left text-xs font-semibold text-copper-300 transition hover:bg-copper-500/10 disabled:opacity-40;
}
.free-live {
  @apply mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-rose-600/10 px-3.5 py-2.5 text-sm text-neutral-300 ring-1 ring-rose-400/30;
}
.free-result {
  @apply mt-3 rounded-xl bg-copper-500/[0.07] px-3.5 py-3 text-sm ring-1 ring-copper-400/25;
}
.tool {
  @apply flex h-7 items-center rounded-lg bg-neutral-800 px-2.5 text-xs font-semibold text-neutral-300 ring-1 ring-white/10 transition outline-none hover:bg-neutral-700 hover:text-white disabled:opacity-35 disabled:hover:bg-neutral-800;
}
.tool.is-accent {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40 hover:bg-copper-500/25;
}
.inspector {
  @apply mt-5 rounded-xl bg-white/[0.03] p-4 ring-1 ring-copper-400/25;
}
</style>
