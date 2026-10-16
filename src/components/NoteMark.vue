<script setup>
// Une note sur le manche : forme (rond, étiquette, losange ou rien) + nom, et éventuellement le degré en dessous
const props = defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  shape: { type: String, default: 'circle' }, // 'circle' | 'rect' | 'diamond' | 'none'
  size: { type: Number, default: 40 }, // diamètre / largeur
  fill: { type: String, default: 'none' },
  fillOpacity: { type: Number, default: 1 },
  stroke: { type: String, default: 'none' },
  strokeWidth: { type: Number, default: 0 },
  dashed: { type: Boolean, default: false },
  text: { type: String, default: '' },
  textColor: { type: String, default: '#fff' },
  fontSize: { type: Number, default: 14 },
  sub: { type: String, default: '' }, // petite ligne sous le nom (degré)
  subColor: { type: String, default: '#fbbf24' },
  halo: { type: String, default: '' }, // contour du texte, pour le lire directement sur le bois
  filter: { type: String, default: '' },
})

const shapeAttrs = () => ({
  fill: props.fill,
  'fill-opacity': props.fillOpacity,
  stroke: props.stroke,
  'stroke-width': props.strokeWidth,
  'stroke-dasharray': props.dashed ? '4 3' : undefined,
})
</script>

<template>
  <g :filter="filter || undefined">
    <circle v-if="shape === 'circle'" :cx="x" :cy="y" :r="size / 2" v-bind="shapeAttrs()" />
    <rect v-else-if="shape === 'rect'" :x="x - size / 2" :y="y - size * 0.37" :width="size" :height="size * 0.74" rx="8" v-bind="shapeAttrs()" />
    <rect
      v-else-if="shape === 'diamond'"
      :x="x - size * 0.36"
      :y="y - size * 0.36"
      :width="size * 0.72"
      :height="size * 0.72"
      rx="4"
      :transform="`rotate(45 ${x} ${y})`"
      v-bind="shapeAttrs()"
    />
    <text
      :x="x"
      :y="sub ? y + 1 : y + fontSize * 0.36"
      text-anchor="middle"
      class="pointer-events-none font-bold"
      :fill="textColor"
      :font-size="text.length >= 4 ? fontSize - 2 : fontSize"
      :stroke="halo || undefined"
      :stroke-width="halo ? 4 : undefined"
      paint-order="stroke"
    >
      {{ text }}
    </text>
    <text v-if="sub" :x="x" :y="y + 13" text-anchor="middle" class="pointer-events-none font-semibold" :fill="subColor" font-size="10">
      {{ sub }}
    </text>
  </g>
</template>
