<script setup>
// Page Phrasés : tes phrasés à toi, enregistrés à la guitare, puis travaillés en boucle en montant le tempo.
// Trois espaces : Studio (enregistrer, retoucher), Entraînement (la boucle, la progression), Progrès (courbes,
// note par note, révisions). Toute la logique est dans composables/usePhraseStudio.js ; ici, l'affichage.
import { computed, provide, ref } from 'vue'
import Fretboard from './components/Fretboard.vue'
import Icon from './components/Icon.vue'
import Metronome from './components/Metronome.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import CalibrationDialog from './components/phrases/CalibrationDialog.vue'
import PhraseLibrary from './components/phrases/PhraseLibrary.vue'
import PracticePanel from './components/phrases/PracticePanel.vue'
import ProgressPanel from './components/phrases/ProgressPanel.vue'
import SessionSummary from './components/phrases/SessionSummary.vue'
import ShortcutsHelp from './components/phrases/ShortcutsHelp.vue'
import StudioPanel from './components/phrases/StudioPanel.vue'
import TabRail from './components/phrases/TabRail.vue'
import { beatLabel, signature } from './components/phrases/format'
import { STUDIO_KEY, usePhraseStudio } from './composables/usePhraseStudio'
import { gridName } from './lib/phrases'
import { reviewLabel } from './lib/phraseCoach'

const s = usePhraseStudio()
provide(STUDIO_KEY, s)

const NO_OVERLAY = new Map() // pas de gamme : seules les notes du phrasé sont posées sur le manche
const p = computed(() => s.phrase)
const bars = computed(() => (p.value ? Math.round(p.value.lengthBeats / p.value.beats) : 0))
const menuOpen = ref(false)
const VIEWS = [
  { id: 'studio', label: 'Studio', icon: 'mic', key: '1' },
  { id: 'practice', label: 'Entraînement', icon: 'repeat', key: '2' },
  { id: 'progress', label: 'Progrès', icon: 'chart', key: '3' },
]
const review = computed(() => (p.value ? reviewLabel(p.value) : ''))
const punchText = computed(() => (s.punch ? `${beatLabel(s.punch.from, p.value.beats)} → ${beatLabel(s.punch.to, p.value.beats)}` : ''))
</script>

<template>
  <Teleport v-if="s.active" defer to="#topbar-actions">
    <button
      class="listen-btn"
      :class="{ on: s.audio.running.value, err: s.audio.error.value }"
      :title="s.audio.error.value || (s.audio.running.value ? 'Arrêter l’écoute de la guitare' : 'Écouter la guitare')"
      @click="s.audio.running.value ? s.audio.stop() : s.audio.start()"
    >
      <Icon name="mic" class="size-4" />
      <span class="max-sm:hidden">{{ s.audio.running.value ? 'Écoute' : 'Écouter' }}</span>
      <span v-if="s.audio.running.value" class="relative h-1.5 w-8 overflow-hidden rounded-full bg-white/10">
        <span class="absolute inset-y-0 left-0 rounded-full bg-copper-400 transition-[width] duration-75" :style="{ width: s.audio.level.value * 100 + '%' }" />
      </span>
    </button>
    <button class="gear-btn max-sm:hidden" title="Raccourcis clavier (?)" @click="s.helpOpen = true">?</button>
    <button class="gear-btn" :class="{ on: s.settingsOpen }" title="Réglages : entrée audio, guitare, affichage" @click="s.settingsOpen = !s.settingsOpen">
      <Icon name="sliders" class="size-5" />
    </button>
  </Teleport>

  <SettingsPanel
    v-if="s.settingsOpen && s.active"
    v-model:tuning-id="s.tuningId"
    v-model:notation="s.notation"
    v-model:label-mode="s.labelMode"
    v-model:body-finish="s.bodyFinish"
    v-model:match-head="s.matchHead"
    v-model:frets="s.frets"
    v-model:show-alternates="s.showAlternates"
    :audio="s.audio"
    @close="s.settingsOpen = false"
  />
  <CalibrationDialog v-if="s.calibration" />
  <ShortcutsHelp v-if="s.helpOpen" />

  <main class="mx-auto flex w-full max-w-[1700px] min-w-0 flex-col gap-5 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:px-8">
    <PhraseLibrary />

    <section class="flex min-w-0 flex-1 flex-col gap-4">
      <!-- Aucun phrasé : mode d'emploi -->
      <div v-if="!p" class="intro rounded-2xl p-8 ring-1 ring-white/5">
        <div class="text-[10px] font-semibold tracking-widest text-copper-400 uppercase">Entraînement de phrasés</div>
        <h1 class="mt-2 text-3xl font-black tracking-tight text-white">Travaille tes propres phrasés, de plus en plus vite.</h1>
        <ol class="mt-6 grid gap-4 sm:grid-cols-3">
          <li class="step-card"><span class="step-n">1</span><b>Enregistre</b> ton phrasé à la guitare : sur le clic du métronome, ou librement, à ton tempo. L'app le transcrit en tablature.</li>
          <li class="step-card"><span class="step-n">2</span><b>Retouche</b> la tablature : glisse une note dans le temps ou sur une autre corde, corrige une technique, recale tout d'un clic.</li>
          <li class="step-card"><span class="step-n">3</span><b>Entraîne-toi</b> en boucle : chaque passage est noté, le tempo monte, l'app repère tes points durs et te dit quand revenir.</li>
        </ol>
        <div class="mt-8 flex flex-wrap gap-3">
          <button class="rec-btn" @click="s.startRecording()"><span class="rec-dot" /> Enregistrer sur le clic</button>
          <button class="ghost-btn" @click="s.startFreeTake">Prise libre, sans clic</button>
        </div>
      </div>

      <template v-else>
        <!-- En-tête : nom, infos, actions -->
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0 flex-1 basis-72">
            <input v-model="p.name" class="name-input" aria-label="Nom du phrasé" maxlength="60" @keydown.enter="$event.target.blur()" />
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
              <template v-if="p.notes.length">
                <span>{{ p.notes.length }} notes</span>
                <span>{{ bars }} mesure{{ bars > 1 ? 's' : '' }} · {{ signature(p.beats) }}</span>
                <span>grille {{ gridName(p.grid).toLowerCase() }}</span>
                <span>enregistré à {{ p.recordBpm }} BPM</span>
                <span v-if="p.bestBpm" class="chip">record <b class="text-copper-300">{{ p.bestBpm }}</b></span>
                <span v-if="review" class="chip" :class="{ due: review === 'à revoir' }">révision : {{ review }}</span>
              </template>
              <span v-else>Pas encore de notes : enregistre ton phrasé sur le clic, ou en prise libre.</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button v-if="p.notes.length" class="ghost-btn" :class="{ on: s.mode === 'listen' }" :disabled="s.mode === 'record' || s.mode === 'practice' || s.mode === 'free'" title="Écouter le phrasé au tempo du métronome" @click="s.mode === 'listen' ? s.stopAll() : s.listen()">
              <Icon :name="s.mode === 'listen' ? 'stop' : 'volume'" class="size-4" />
              Écouter
            </button>
            <button class="rec-btn" :class="{ on: s.mode === 'record' }" title="Enregistrer sur le clic (R)" :disabled="s.mode === 'practice' || s.mode === 'free'" @click="s.mode === 'record' ? s.stopAll() : s.startRecording()">
              <span class="rec-dot" />
              {{ s.mode === 'record' ? 'Terminer' : p.notes.length ? 'Réenregistrer' : 'Enregistrer' }}
            </button>
            <button class="train-btn" :class="{ on: s.mode === 'practice' }" :disabled="!p.notes.length || s.mode === 'record' || s.mode === 'free'" title="S'entraîner (Espace)" @click="s.mode === 'practice' ? s.stopAll() : s.startPractice()">
              <Icon :name="s.mode === 'practice' ? 'stop' : 'play'" class="size-4" />
              {{ s.mode === 'practice' ? 'Arrêter' : "S'entraîner" }}
            </button>
            <div class="relative">
              <button class="ghost-btn px-2.5" aria-label="Autres actions" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">⋯</button>
              <template v-if="menuOpen">
                <div class="fixed inset-0 z-30" @click="(menuOpen = false), (s.confirmDelete = false)" />
                <div class="menu">
                  <button @click="(s.duplicatePhrase(), (menuOpen = false))">Dupliquer</button>
                  <button :disabled="!p.notes.length" @click="(s.exportCurrent(), (menuOpen = false))">Exporter ce phrasé…</button>
                  <button class="danger" @click="s.confirmDelete ? (s.deletePhrase(), (menuOpen = false)) : s.deletePhrase()">{{ s.confirmDelete ? 'Confirmer la suppression' : 'Supprimer' }}</button>
                </div>
              </template>
            </div>
          </div>
        </header>

        <!-- Espaces -->
        <nav class="views" aria-label="Espaces de la page">
          <button v-for="v in VIEWS" :key="v.id" :class="{ on: s.view === v.id }" :title="`${v.label} (${v.key})`" @click="s.view = v.id">
            <Icon :name="v.icon" class="size-4" />
            {{ v.label }}
            <span v-if="v.id === 'practice' && s.mode === 'practice'" class="live-dot" />
          </button>
        </nav>

        <!-- Manche -->
        <div class="relative">
          <Fretboard
            :tuning="s.tuning"
            :frets="s.frets"
            :overlay="NO_OVERLAY"
            :notation="s.notation"
            :label-mode="s.labelMode"
            :body-finish="s.bodyFinish"
            :match-head="s.matchHead"
            :played="s.selectedPlayed ?? s.played"
            :alternates="s.alternates"
            :marks="s.marks"
            :links="s.links"
            @play="s.onFretClick"
          />
          <!-- Décompte, états, annonces, bilan : par-dessus le manche -->
          <Transition name="pop">
            <div v-if="s.counting" :key="s.countdown" class="countdown pointer-events-none absolute inset-0 flex items-center justify-center">
              <span>{{ s.countdown }}</span>
            </div>
          </Transition>
          <div v-if="s.mode === 'record' && !s.counting" class="state-badge rec pointer-events-none"><span class="rec-dot animate-pulse" /> {{ s.punch ? `Section ${punchText} · joue` : 'Enregistrement · joue ton phrasé' }}</div>
          <div v-else-if="s.mode === 'free'" class="state-badge rec pointer-events-none"><span class="rec-dot animate-pulse" /> Prise libre · joue à ton tempo · {{ s.freeCount }} note{{ s.freeCount > 1 ? 's' : '' }}</div>
          <div v-else-if="s.demoPlaying" class="state-badge demo pointer-events-none">🎧 Écoute… puis rejoue-le</div>
          <div v-else-if="s.clickMuted" class="state-badge quiet pointer-events-none">Clic coupé · garde le tempo</div>
          <Transition name="toast">
            <div v-if="s.toast" :key="s.toast.id" class="toast pointer-events-none" :class="`tone-${s.toast.tone}`">{{ s.toast.text }}</div>
          </Transition>
          <div v-if="s.summary && s.mode === 'idle'" class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <SessionSummary />
          </div>
        </div>

        <!-- Tablature -->
        <TabRail />

        <!-- Espace courant + métronome -->
        <ProgressPanel v-if="s.view === 'progress'" />
        <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <StudioPanel v-if="s.view === 'studio'" />
          <PracticePanel v-else />
          <Metronome :metro="s.metro" :shortcuts="false" class="min-h-56" />
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
@reference "./style.css";

.listen-btn {
  @apply flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white;
}
.listen-btn.on {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40;
}
.listen-btn.err {
  @apply text-rose-300 ring-rose-400/40;
}
.gear-btn {
  @apply flex size-9 items-center justify-center rounded-xl text-sm font-black text-neutral-400 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white;
}
.gear-btn.on {
  @apply bg-white/10 text-white;
}

/* ---------- En-tête ---------- */
.name-input {
  @apply w-full rounded-lg bg-transparent text-2xl font-black tracking-tight text-white outline-none sm:text-3xl;
}
.name-input:hover,
.name-input:focus {
  @apply bg-white/[0.03];
}
.chip {
  @apply rounded-full bg-white/5 px-2 py-0.5 ring-1 ring-white/10;
}
.chip.due {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40;
}
.rec-btn {
  @apply flex h-10 items-center gap-2 rounded-xl bg-neutral-800 px-4 text-sm font-bold text-neutral-100 ring-1 ring-white/10 transition hover:bg-neutral-700 disabled:opacity-40;
}
.rec-btn.on {
  @apply bg-rose-600 text-white ring-rose-400/60 hover:bg-rose-500;
}
.rec-dot {
  @apply size-2.5 rounded-full bg-rose-500;
}
.rec-btn.on .rec-dot {
  @apply animate-pulse bg-white;
}
.train-btn {
  @apply flex h-10 items-center gap-2 rounded-xl bg-copper-500 px-5 text-sm font-bold text-white transition hover:bg-copper-400 disabled:opacity-40 disabled:hover:bg-copper-500;
}
.train-btn.on {
  @apply bg-neutral-800 text-neutral-100 ring-1 ring-white/10 hover:bg-neutral-700;
}
.ghost-btn {
  @apply flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white disabled:opacity-40;
}
.ghost-btn.on {
  @apply bg-white/10 text-white;
}
.menu {
  @apply absolute top-full right-0 z-40 mt-2 flex w-52 flex-col rounded-xl p-1.5 shadow-2xl ring-1 ring-white/10;
  background: #1a1817;
}
.menu button {
  @apply rounded-lg px-3 py-2 text-left text-sm font-semibold text-neutral-300 hover:bg-white/5 hover:text-white disabled:opacity-40;
}
.menu button.danger {
  @apply text-rose-300;
}

/* ---------- Espaces ---------- */
.views {
  @apply -mb-1 flex gap-1 border-b border-white/5;
}
.views button {
  @apply relative -mb-px flex items-center gap-2 border-b-2 border-transparent px-3 pb-2.5 text-sm font-semibold text-neutral-500 transition hover:text-neutral-200;
}
.views button.on {
  @apply border-copper-400 text-white;
}
.live-dot {
  @apply size-1.5 animate-pulse rounded-full bg-copper-400;
}

/* ---------- Mode d'emploi ---------- */
.intro {
  background: radial-gradient(120% 140% at 0% 0%, rgba(201, 120, 70, 0.12), transparent 55%), #171514;
}
.step-card {
  @apply relative rounded-xl bg-white/[0.03] p-4 pt-10 text-sm leading-relaxed text-neutral-400 ring-1 ring-white/5;
}
.step-card b {
  @apply text-neutral-100;
}
.step-n {
  @apply absolute top-3 left-4 flex size-6 items-center justify-center rounded-full bg-copper-500/20 text-xs font-black text-copper-300;
}

/* ---------- Superpositions du manche ---------- */
.countdown span {
  @apply text-[9rem] leading-none font-black text-white;
  text-shadow: 0 0 40px rgba(232, 140, 80, 0.7);
}
.pop-enter-active {
  transition: all 0.25s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.pop-leave-active {
  transition: all 0.2s ease-in;
  position: absolute;
}
.pop-enter-from {
  opacity: 0;
  transform: scale(1.6);
}
.pop-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
/* Dans la bande libre au-dessus du manche : rien ne cache les notes de la corde aiguë */
.state-badge {
  @apply absolute top-3 left-6 flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold whitespace-nowrap text-white shadow-lg;
}
.state-badge.rec {
  @apply bg-rose-600/90;
}
.state-badge.demo {
  @apply bg-copper-500/90;
}
.state-badge.quiet {
  @apply bg-neutral-800/90 ring-1 ring-white/15;
}
.toast {
  @apply absolute top-2.5 left-1/2 -translate-x-1/2 rounded-full px-5 py-1.5 text-sm font-black tracking-wide whitespace-nowrap text-white;
}
.toast.tone-copper {
  @apply bg-copper-500 shadow-[0_0_30px] shadow-copper-500/60;
}
.toast.tone-gold {
  @apply bg-amber-500 text-neutral-950 shadow-[0_0_30px] shadow-amber-400/60;
}
.toast.tone-muted {
  @apply bg-neutral-700 ring-1 ring-white/15;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
