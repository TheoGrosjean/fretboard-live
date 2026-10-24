<script setup>
// Barre du haut : écoute de la guitare, avec un mini vu-mètre (Manche et Phrasés)
import Icon from './Icon.vue'

const props = defineProps({
  audio: { type: Object, required: true }, // useAudioInput()
})
const toggle = () => (props.audio.running.value ? props.audio.stop() : props.audio.start())
</script>

<template>
  <button
    class="listen-btn"
    :class="{ on: audio.running.value, err: audio.error.value }"
    :title="audio.error.value || (audio.running.value ? 'Arrêter l’écoute de la guitare' : 'Écouter la guitare')"
    @click="toggle"
  >
    <Icon name="mic" class="size-4" />
    <span class="max-sm:hidden">{{ audio.running.value ? 'Écoute' : 'Écouter' }}</span>
    <span v-if="audio.running.value" class="relative h-1.5 w-8 overflow-hidden rounded-full bg-white/10">
      <span class="absolute inset-y-0 left-0 rounded-full bg-copper-400 transition-[width] duration-75" :style="{ width: audio.level.value * 100 + '%' }" />
    </span>
  </button>
</template>

<style scoped>
@reference "../style.css";

.listen-btn {
  @apply flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white;
}
.listen-btn.on {
  @apply bg-copper-500/15 text-copper-300 ring-copper-400/40;
}
.listen-btn.err {
  @apply text-rose-300 ring-rose-400/40;
}
</style>
