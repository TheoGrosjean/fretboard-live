<script setup>
// Finisher « cinématique » : l'écran s'assombrit lentement, bandes noires de cinéma,
// un fin trait cuivre s'étire depuis le centre, puis le titre et le score en sobriété.
import { formatScore, useCountUp } from './useCountUp'

const props = defineProps({
  result: { type: Object, required: true },
  freezeAt: { type: Number, default: null },
})
defineEmits(['close'])

const score = useCountUp(props.result.score, { delay: 2200, duration: 1600, freezeAt: props.freezeAt })
</script>

<template>
  <div class="finisher absolute inset-0 cursor-pointer overflow-hidden" @click="$emit('close')">
    <div class="veil absolute inset-0" />
    <div class="bar top" />
    <div class="bar bottom" />

    <div class="content">
      <div class="over">Session terminée</div>
      <div class="line" />
      <div class="title">{{ result.title }}</div>
      <div class="artist">{{ result.artist }}</div>
      <div class="score">{{ formatScore(score) }}</div>
      <div class="meta">
        <span>Rang {{ result.rank }}</span>
        <span>·</span>
        <span>Combo {{ result.bestCombo }}</span>
        <span>·</span>
        <span>{{ result.accuracy }} %</span>
        <span>·</span>
        <span>{{ result.style }}</span>
      </div>
      <div v-if="result.newRecord" class="record">— nouveau record —</div>
    </div>
  </div>
</template>

<style scoped>
.finisher {
  container-type: size;
}
.veil {
  background: radial-gradient(ellipse at center, rgba(12, 10, 9, 0.75), rgba(0, 0, 0, 0.95));
  opacity: 0;
  animation: fade 1.4s ease forwards;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  height: 12%;
  background: #000;
  animation: bar 1.2s cubic-bezier(0.6, 0, 0.2, 1) 0.3s forwards;
}
.bar.top {
  top: 0;
  transform: translateY(-100%);
}
.bar.bottom {
  bottom: 0;
  transform: translateY(100%);
}
@keyframes bar {
  to {
    transform: none;
  }
}

.content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #f5f0e6;
  text-align: center;
}
.over {
  font-size: 2.2cqh;
  letter-spacing: 0.7em;
  text-transform: uppercase;
  color: #f0956a;
  opacity: 0;
  animation: fade 1.2s ease 1.4s forwards;
}
.line {
  margin: 2.5cqh 0;
  width: 40cqw;
  height: 1px;
  background: linear-gradient(90deg, transparent, #f0956a, transparent);
  transform: scaleX(0);
  animation: line 1.4s cubic-bezier(0.6, 0, 0.2, 1) 1.1s forwards;
}
@keyframes line {
  to {
    transform: scaleX(1);
  }
}
.title {
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-size: 7cqh;
  line-height: 1.1;
  opacity: 0;
  filter: blur(0.6cqh);
  animation: focus 1.6s ease 1.7s forwards;
}
.artist {
  margin-top: 0.8cqh;
  font-size: 2.2cqh;
  color: #a8a29e;
  letter-spacing: 0.2em;
  opacity: 0;
  animation: fade 1s ease 2s forwards;
}
@keyframes focus {
  to {
    opacity: 1;
    filter: blur(0);
  }
}
.score {
  margin-top: 4cqh;
  font-size: 6cqh;
  font-weight: 200;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  animation: fade 0.8s ease 2.2s forwards;
}
.meta {
  margin-top: 1.2cqh;
  display: flex;
  gap: 1.2cqw;
  font-size: 2cqh;
  letter-spacing: 0.15em;
  color: #a8a29e;
  opacity: 0;
  animation: fade 1s ease 2.8s forwards;
}
.record {
  margin-top: 2cqh;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-size: 2.4cqh;
  color: #f0956a;
  opacity: 0;
  animation: fade 1s ease 3.4s forwards;
}
@keyframes fade {
  to {
    opacity: 1;
  }
}
</style>
