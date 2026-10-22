<script setup>
// Menu déroulant léger : un bouton (le choix actuel + chevron) qui ouvre une liste ou une grille d'options.
// Un clic en dehors, ou Échap, le referme.
import { computed, ref } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: null },
  options: { type: Array, required: true }, // [{ value, label }]
  columns: { type: Number, default: 1 }, // > 1 : grille (ex. les 12 notes)
  label: { type: String, default: '' }, // nom accessible du menu
  buttonClass: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const current = computed(() => props.options.find((o) => o.value === props.modelValue))
function choose(value) {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <div class="relative inline-flex" @keydown.esc="open = false">
    <button
      class="dropdown-btn group inline-flex items-center gap-1.5"
      :class="[buttonClass, { 'is-open': open }]"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      <slot :current="current">{{ current?.label ?? '—' }}</slot>
      <svg class="chevron size-[0.55em] shrink-0 opacity-50 transition group-hover:opacity-90" :class="{ 'rotate-180': open }" viewBox="0 0 20 20" fill="currentColor"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" /></svg>
    </button>
    <template v-if="open">
      <div class="fixed inset-0 z-40" @click="open = false" />
      <div
        class="menu absolute top-full left-0 z-50 mt-2 max-h-[60vh] min-w-48 overflow-y-auto rounded-xl p-1.5"
        :class="columns > 1 ? 'grid gap-1' : 'flex flex-col'"
        :style="columns > 1 ? { gridTemplateColumns: `repeat(${columns}, minmax(2.75rem, 1fr))` } : null"
        role="listbox"
      >
        <button
          v-for="o in options"
          :key="o.value"
          role="option"
          :aria-selected="o.value === modelValue"
          class="rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition"
          :class="[columns > 1 ? 'text-center' : 'text-left', o.value === modelValue ? 'bg-copper-500 text-white' : 'text-neutral-300 hover:bg-white/8 hover:text-white']"
          @click="choose(o.value)"
        >
          {{ o.label }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.menu {
  background: #1a1817;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 20px 50px -12px rgba(0, 0, 0, 0.8);
  animation: menu-in 0.14s ease-out;
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
