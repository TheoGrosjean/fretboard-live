<script setup>
// Panneau des réglages du Manche (bouton ⚙ de la barre du haut) : entrée audio, guitare et affichage
import { BODY_FINISHES } from '../lib/noteStyles'
import { TUNINGS } from '../lib/music'
import { CLICK_SOUNDS, clickSound, previewClick } from '../composables/useMetronome'

defineProps({ audio: { type: Object, required: true } }) // voir useAudioInput
const emit = defineEmits(['close'])
const tuningId = defineModel('tuningId', { type: String, required: true })
const notation = defineModel('notation', { type: String, required: true })
const labelMode = defineModel('labelMode', { type: String, required: true })
const bodyFinish = defineModel('bodyFinish', { type: String, required: true })
const matchHead = defineModel('matchHead', { type: Boolean, required: true })
const frets = defineModel('frets', { type: Number, required: true })
const showAlternates = defineModel('showAlternates', { type: Boolean, required: true })
</script>

<template>
  <div class="fixed inset-0 z-40" @click="emit('close')" />
  <div class="panel fixed top-16 right-3 left-3 z-50 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl p-5 sm:left-auto sm:w-96" @keydown.esc="emit('close')">
    <!-- Entrée audio -->
    <section>
      <h3 class="panel-title">
        Entrée audio
        <span class="ml-auto flex items-center gap-1.5 font-normal tracking-normal normal-case" :class="audio.running.value ? 'text-copper-400' : 'text-neutral-600'">
          <span class="size-2 rounded-full" :class="audio.running.value ? 'animate-pulse bg-copper-400' : 'bg-neutral-700'" />
          {{ audio.running.value ? `${audio.sampleRate.value / 1000} kHz` : 'Arrêtée' }}
        </span>
      </h3>
      <div class="space-y-3">
        <label class="block">
          <span class="field-label">Interface</span>
          <select class="field" :value="audio.deviceId.value" @change="audio.setDevice($event.target.value)">
            <option v-if="!audio.devices.value.length" value="">Lance l'écoute pour voir tes interfaces</option>
            <option v-for="d in audio.devices.value" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Entrée audio' }}</option>
          </select>
        </label>
        <label class="block">
          <span class="field-label">Canal</span>
          <select class="field" :value="audio.channel.value" @change="audio.setChannel($event.target.value)">
            <option value="mix">Toutes les entrées</option>
            <option value="0">Entrée 1</option>
            <option value="1">Entrée 2</option>
          </select>
        </label>
        <label class="block">
          <span class="field-label flex justify-between">Sensibilité <span class="tabular-nums">{{ audio.sensitivity.value }} %</span></span>
          <input type="range" min="0" max="100" step="1" class="w-full accent-copper-400" :value="audio.sensitivity.value" @input="audio.setSensitivity(Number($event.target.value))" />
        </label>
        <!-- Vu-mètre, avec le seuil de sensibilité -->
        <div class="relative h-2 overflow-hidden rounded-full bg-neutral-800">
          <div class="h-full rounded-full bg-linear-to-r from-copper-500 via-copper-400 to-rose-500 transition-[width] duration-75" :style="{ width: audio.level.value * 100 + '%' }" />
          <div class="absolute top-0 h-full w-0.5 bg-white/60" :style="{ left: audio.thresholdLevel.value * 100 + '%' }" />
        </div>
        <p v-if="audio.error.value" class="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{{ audio.error.value }}</p>
      </div>
    </section>

    <!-- Métronome -->
    <section class="mt-6 border-t border-white/5 pt-5">
      <h3 class="panel-title">Métronome</h3>
      <span class="field-label">Son du clic</span>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="c in CLICK_SOUNDS"
          :key="c.id"
          class="rounded-lg px-2 py-2 text-xs font-semibold ring-1 transition"
          :class="clickSound === c.id ? 'bg-copper-500 text-white ring-copper-400' : 'text-neutral-300 ring-white/10 hover:bg-white/5'"
          :title="`Écouter et choisir : ${c.label}`"
          @click="(clickSound = c.id), previewClick(c.id)"
        >
          {{ c.label }}
        </button>
      </div>
      <p class="mt-2 text-xs text-neutral-500">Clique pour écouter. Le choix vaut pour tous les métronomes du site.</p>
    </section>

    <!-- Guitare et affichage -->
    <section class="mt-6 border-t border-white/5 pt-5">
      <h3 class="panel-title">Guitare et affichage</h3>
      <div class="space-y-4">
        <label class="block">
          <span class="field-label">Guitare</span>
          <select v-model="tuningId" class="field">
            <option v-for="t in TUNINGS" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <span class="field-label">Notation</span>
            <div class="segmented grid-cols-2">
              <button :class="{ 'is-active': notation === 'fr' }" @click="notation = 'fr'">Do Ré</button>
              <button :class="{ 'is-active': notation === 'en' }" @click="notation = 'en'">C D</button>
            </div>
          </div>
          <div>
            <span class="field-label">Sur le manche</span>
            <div class="segmented grid-cols-2">
              <button :class="{ 'is-active': labelMode === 'note' }" @click="labelMode = 'note'">Notes</button>
              <button :class="{ 'is-active': labelMode === 'degree' }" @click="labelMode = 'degree'">Degrés</button>
            </div>
          </div>
        </div>
        <div>
          <span class="field-label">Couleur du corps</span>
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="f in BODY_FINISHES"
              :key="f.id"
              :title="f.name"
              :aria-label="f.name"
              class="size-7 rounded-full ring-offset-2 ring-offset-neutral-900 transition"
              :class="bodyFinish === f.id ? 'ring-2 ring-copper-400' : 'ring-1 ring-white/15 hover:ring-white/40'"
              :style="{ background: f.color }"
              @click="bodyFinish = f.id"
            />
          </div>
          <label class="mt-2 flex cursor-pointer items-center gap-2">
            <input v-model="matchHead" type="checkbox" class="size-4 accent-copper-400" />
            <span class="text-sm text-neutral-300">Tête assortie au corps</span>
          </label>
        </div>
        <div class="grid grid-cols-2 items-end gap-3">
          <label class="block">
            <span class="field-label">Cases</span>
            <select v-model.number="frets" class="field">
              <option :value="21">21</option>
              <option :value="22">22</option>
              <option :value="24">24</option>
            </select>
          </label>
          <label class="flex cursor-pointer items-center gap-2 pb-2">
            <input v-model="showAlternates" type="checkbox" class="size-4 accent-copper-400" />
            <span class="text-sm text-neutral-300">Autres positions</span>
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
@reference "../style.css";

.panel {
  background: #171514;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 30px 80px -20px rgba(0, 0, 0, 0.9);
  animation: panel-in 0.16s ease-out;
}
@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}
.panel-title {
  @apply mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-neutral-400 uppercase;
}
</style>
