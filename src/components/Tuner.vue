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
  <section class="shrink-0 rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5">
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Accordeur</h2>

    <div class="flex items-end justify-between gap-4">
      <div>
        <div class="text-5xl font-black tabular-nums" :class="!active ? 'text-neutral-700' : inTune ? 'text-emerald-400' : 'text-neutral-100'">
          {{ active ? noteName(target, notation, true) : '—' }}
        </div>
        <div class="mt-1 text-sm text-neutral-500 tabular-nums">
          <template v-if="active">{{ frequency.toFixed(1) }} Hz · cible {{ midiToFreq(target).toFixed(1) }} Hz</template>
          <template v-else>Joue une note…</template>
        </div>
      </div>
      <div
        class="text-2xl font-bold tabular-nums"
        :class="!active ? 'text-neutral-700' : inTune ? 'text-emerald-400' : cents < 0 ? 'text-sky-400' : 'text-orange-400'"
      >
        {{ active ? `${cents > 0 ? '+' : ''}${cents.toFixed(0)}` : '0' }}<span class="text-sm"> cents</span>
      </div>
    </div>

    <div class="relative mt-5 h-8">
      <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-500/40 via-emerald-400/60 to-orange-500/40" />
      <div v-for="t in [0, 25, 50, 75, 100]" :key="t" class="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-neutral-600" :style="{ left: t + '%' }" />
      <div
        class="absolute top-0 h-8 w-1.5 -translate-x-1/2 rounded-full transition-all duration-75"
        :class="!active ? 'bg-neutral-700' : inTune ? 'bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400' : 'bg-neutral-100'"
        :style="{ left: needle + '%' }"
      />
    </div>
    <div class="mt-1 flex justify-between text-[11px] text-neutral-600">
      <span>-50</span><span>trop bas</span><span>0</span><span>trop haut</span><span>+50</span>
    </div>
  </section>
</template>
