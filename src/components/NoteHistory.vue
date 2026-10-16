<script setup>
import { noteName } from '../lib/music'

defineProps({
  items: { type: Array, required: true }, // [{ id, midi, string, fret, info, outside }]
  notation: { type: String, default: 'en' },
})
defineEmits(['clear'])
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Historique</h2>
      <button v-if="items.length" class="text-xs text-neutral-500 hover:text-neutral-200" @click="$emit('clear')">Effacer</button>
    </div>

    <p v-if="!items.length" class="text-sm text-neutral-600">Les notes jouées apparaîtront ici.</p>

    <TransitionGroup v-else tag="ul" name="hist" class="flex min-h-0 flex-wrap content-start gap-2 overflow-y-auto">
      <li
        v-for="(n, i) in items"
        :key="n.id"
        class="flex min-w-14 flex-col items-center rounded-lg px-2.5 py-1.5 ring-1"
        :class="[
          n.outside ? 'bg-rose-500/10 ring-rose-500/40' : n.info?.isRoot ? 'bg-copper-500/15 ring-copper-400/50' : 'bg-stone-800/60 ring-stone-600/50',
          i === 0 ? '' : 'opacity-70',
        ]"
      >
        <span class="text-base font-bold" :class="n.outside ? 'text-rose-300' : n.info?.isRoot ? 'text-copper-300' : 'text-stone-100'">
          {{ noteName(n.midi, notation, true) }}
        </span>
        <span class="text-[10px] text-neutral-500 tabular-nums">
          <template v-if="n.info">{{ n.info.degree }} · </template>c{{ n.string + 1 }} f{{ n.fret }}
        </span>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.hist-enter-from {
  opacity: 0;
  transform: translateX(-12px) scale(0.9);
}
.hist-enter-active,
.hist-move {
  transition: all 0.2s ease;
}
.hist-leave-active {
  display: none;
}
</style>
