<script setup>
// Finisher « résultats de jeu de rythme » : rideau qui se ferme, lettre du rang géante,
// étoiles qui s'allument une à une, score qui défile.
import { computed } from 'vue'
import { formatScore, useCountUp } from './useCountUp'

const props = defineProps({
  result: { type: Object, required: true },
  freezeAt: { type: Number, default: null },
})
defineEmits(['close'])

const score = useCountUp(props.result.score, { delay: 1500, duration: 1300, freezeAt: props.freezeAt })
const stars = computed(() => ({ S: 5, A: 4, B: 3, C: 2 })[props.result.rank] ?? 1)
</script>

<template>
  <div class="finisher absolute inset-0 cursor-pointer overflow-hidden" @click="$emit('close')">
    <div class="curtain top" />
    <div class="curtain bottom" />

    <div class="content">
      <div class="heading">RÉSULTATS</div>
      <div class="track">{{ result.title }} · {{ result.artist }}</div>

      <div class="rank" :class="`rank-${result.rank}`">{{ result.rank }}</div>
      <div class="word">{{ result.word }}</div>

      <div class="stars">
        <svg v-for="i in 5" :key="i" viewBox="0 0 24 24" class="star" :class="{ on: i <= stars }" :style="{ '--i': i }">
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
        </svg>
      </div>

      <div class="score">{{ formatScore(score) }}</div>
      <div v-if="result.newRecord" class="record">NOUVEAU RECORD</div>

      <div class="row">
        <div>
          <b>{{ result.bestCombo }}</b>
          <i>meilleur combo</i>
        </div>
        <div>
          <b>{{ result.accuracy }} %</b>
          <i>précision</i>
        </div>
        <div>
          <b>{{ result.style }}</b>
          <i>ton style</i>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.finisher {
  container-type: size;
}
.curtain {
  position: absolute;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(#141210, #0b0a09);
  animation: curtain 0.6s cubic-bezier(0.7, 0, 0.2, 1) forwards;
}
.curtain.top {
  top: 0;
  transform: translateY(-100%);
  border-bottom: 0.3cqh solid #e2683a;
}
.curtain.bottom {
  bottom: 0;
  transform: translateY(100%);
  border-top: 0.3cqh solid #e2683a;
}
@keyframes curtain {
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
  color: #fff;
}
.heading {
  font-size: 2.4cqh;
  font-weight: 800;
  letter-spacing: 0.6em;
  color: #f0956a;
  opacity: 0;
  animation: fade 0.4s ease 0.6s forwards;
}
.track {
  margin-top: 0.6cqh;
  font-size: 2.2cqh;
  color: #a8a29e;
  opacity: 0;
  animation: fade 0.4s ease 0.7s forwards;
}
.rank {
  margin-top: 1cqh;
  font-size: 30cqh;
  line-height: 0.85;
  font-weight: 900;
  opacity: 0;
  animation: reveal 0.7s cubic-bezier(0.2, 1.2, 0.3, 1) 0.8s forwards;
}
.rank-S {
  background: linear-gradient(180deg, #fff3e0, #fbbf77 45%, #e2683a);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 4cqh rgba(251, 191, 119, 0.55));
}
.rank-A {
  color: #f0956a;
}
.rank-B {
  color: #d6d3d1;
}
.rank-C {
  color: #78716c;
}
@keyframes reveal {
  from {
    opacity: 0;
    transform: scale(1.8);
    filter: blur(2cqh);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.word {
  font-size: 4cqh;
  font-weight: 900;
  letter-spacing: 0.2em;
  opacity: 0;
  animation: fade 0.4s ease 1.2s forwards;
}
.stars {
  margin-top: 1.5cqh;
  display: flex;
  gap: 1.2cqw;
}
.star {
  width: 5cqh;
  height: 5cqh;
  fill: #2a2622;
  stroke: #44403c;
  stroke-width: 1;
}
.star.on {
  animation: star 0.35s cubic-bezier(0.3, 1.8, 0.5, 1) calc(1.3s + var(--i) * 0.15s) forwards;
}
@keyframes star {
  50% {
    transform: scale(1.5);
  }
  to {
    fill: #fbbf77;
    stroke: #fde3c8;
    transform: scale(1);
    filter: drop-shadow(0 0 1.2cqh rgba(251, 191, 119, 0.8));
  }
}
.score {
  margin-top: 2cqh;
  font-size: 7cqh;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  animation: fade 0.3s ease 1.5s forwards;
}
.record {
  font-size: 2.2cqh;
  font-weight: 900;
  letter-spacing: 0.3em;
  color: #f0956a;
  opacity: 0;
  animation:
    fade 0.3s ease 2.8s forwards,
    pulse 0.9s ease-in-out 3.1s infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.row {
  margin-top: 3cqh;
  display: flex;
  gap: 6cqw;
  text-align: center;
  opacity: 0;
  animation: fade 0.5s ease 2.2s forwards;
}
.row div {
  display: flex;
  flex-direction: column;
}
.row b {
  font-size: 3.6cqh;
  font-weight: 800;
}
.row i {
  font-style: normal;
  font-size: 1.7cqh;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #78716c;
}
@keyframes fade {
  to {
    opacity: 1;
  }
}
</style>
