<script setup>
import { computed } from 'vue'
import { midiToFreq, noteName } from '../lib/music'

const props = defineProps({
  midiFloat: { type: Number, default: null },
  frequency: { type: Number, default: null },
  notation: { type: String, default: 'en' },
})

const active = computed(() => props.midiFloat !== null)
const target = computed(() => (active.value ? Math.round(props.midiFloat) : null))
const cents = computed(() => (active.value ? (props.midiFloat - target.value) * 100 : 0))
const inTune = computed(() => active.value && Math.abs(cents.value) < 5)
const needle = computed(() => 50 + Math.max(-50, Math.min(50, cents.value)))
</script>

<template>
  <!-- Version compacte : tout sur une ligne (note, aiguille, écart en cents) -->
  <section class="shrink-0 rounded-2xl bg-neutral-900 px-5 py-3 ring-1 ring-white/5">
    <div class="flex items-center gap-4">
      <div class="w-20 shrink-0">
        <div class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Accordeur</div>
        <div class="text-2xl leading-tight font-black tabular-nums" :class="!active ? 'text-neutral-700' : inTune ? 'text-emerald-400' : 'text-neutral-100'">
          {{ active ? noteName(target, notation, true) : '—' }}
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <div class="relative h-6">
          <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-linear-to-r from-sky-500/40 via-emerald-400/60 to-orange-500/40" />
          <div v-for="t in [0, 25, 50, 75, 100]" :key="t" class="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-neutral-600" :style="{ left: t + '%' }" />
          <div
            class="absolute top-0 h-6 w-1.5 -translate-x-1/2 rounded-full transition-all duration-75"
            :class="!active ? 'bg-neutral-700' : inTune ? 'bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400' : 'bg-neutral-100'"
            :style="{ left: needle + '%' }"
          />
        </div>
        <div class="flex justify-between text-[10px] text-neutral-600 tabular-nums">
          <span>trop bas</span>
          <span v-if="active">{{ frequency.toFixed(1) }} Hz · cible {{ midiToFreq(target).toFixed(1) }} Hz</span>
          <span>trop haut</span>
        </div>
      </div>

      <div
        class="w-16 shrink-0 text-right text-lg font-bold tabular-nums"
        :class="!active ? 'text-neutral-700' : inTune ? 'text-emerald-400' : cents < 0 ? 'text-sky-400' : 'text-orange-400'"
      >
        {{ active ? `${cents > 0 ? '+' : ''}${cents.toFixed(0)}` : '0' }}<span class="text-xs"> ct</span>
      </div>
    </div>
  </section>
</template>
