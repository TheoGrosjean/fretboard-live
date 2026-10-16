<script setup>
// Finisher « Persona / anime » : bandes inclinées qui glissent depuis les bords, trame de points,
// typographie de travers en tailles mélangées, stats en cartes penchées qui arrivent en cascade.
import { formatScore, useCountUp } from './useCountUp'

const props = defineProps({
  result: { type: Object, required: true },
  freezeAt: { type: Number, default: null },
})
defineEmits(['close'])

const score = useCountUp(props.result.score, { delay: 1100, duration: 1000, freezeAt: props.freezeAt })
const letters = (text) => [...text].map((ch, i) => ({ ch: ch === ' ' ? ' ' : ch, i }))
</script>

<template>
  <div class="finisher absolute inset-0 cursor-pointer overflow-hidden" @click="$emit('close')">
    <div class="bg absolute inset-0" />
    <div class="dots absolute inset-0" />

    <!-- Bandes -->
    <div class="strip s1" />
    <div class="strip s2" />
    <div class="strip s3" />

    <!-- Titre -->
    <div class="title">
      <div class="small">SESSION</div>
      <div class="big">
        <span v-for="l in letters(result.word)" :key="l.i" :style="{ '--i': l.i }">{{ l.ch }}</span>
      </div>
      <div class="track">♪ {{ result.title }} — {{ result.artist }}</div>
    </div>

    <!-- Rang dans une étoile -->
    <div class="burst" :class="`rank-${result.rank}`">
      <span>{{ result.rank }}</span>
    </div>

    <!-- Cartes de stats -->
    <div class="cards">
      <div class="card" style="--d: 0">
        <i>SCORE</i>
        <b>{{ formatScore(score) }}</b>
      </div>
      <div class="card" style="--d: 1">
        <i>MAX COMBO</i>
        <b>{{ result.bestCombo }}</b>
      </div>
      <div class="card" style="--d: 2">
        <i>PRÉCISION</i>
        <b>{{ result.accuracy }}%</b>
      </div>
      <div class="card accent" style="--d: 3">
        <i>STYLE</i>
        <b>{{ result.style }}</b>
      </div>
    </div>
    <div v-if="result.newRecord" class="record">★ NEW RECORD ★</div>
  </div>
</template>

<style scoped>
.finisher {
  container-type: size;
}
.bg {
  background: #0b0b0b;
  clip-path: polygon(0 0, 0 0, 0 100%, 0 100%);
  animation: open 0.35s cubic-bezier(0.7, 0, 0.3, 1) forwards;
}
@keyframes open {
  to {
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
  }
}
.dots {
  background-image: radial-gradient(rgba(240, 149, 106, 0.22) 22%, transparent 24%);
  background-size: 2.4cqw 2.4cqw;
  mask-image: linear-gradient(115deg, transparent 30%, #000 75%);
  opacity: 0;
  animation: fade 0.6s ease 0.3s forwards;
}

.strip {
  position: absolute;
  left: -20%;
  width: 140%;
  transform: rotate(-12deg) translateX(-110%);
}
.s1 {
  top: 6%;
  height: 22cqh;
  background: #e2683a;
  animation: slide 0.4s cubic-bezier(0.2, 0.9, 0.3, 1) 0.15s forwards;
}
.s2 {
  top: 25%;
  height: 4cqh;
  background: #f5ead6;
  animation: slide-r 0.4s cubic-bezier(0.2, 0.9, 0.3, 1) 0.25s forwards;
  transform: rotate(-12deg) translateX(110%);
}
.s3 {
  top: 70%;
  height: 40cqh;
  background: #e2683a;
  opacity: 0.92;
  animation: slide 0.45s cubic-bezier(0.2, 0.9, 0.3, 1) 0.3s forwards;
}
@keyframes slide {
  to {
    transform: rotate(-12deg) translateX(0);
  }
}
@keyframes slide-r {
  to {
    transform: rotate(-12deg) translateX(0);
  }
}

.title {
  position: absolute;
  left: 7%;
  top: 31%;
  transform: rotate(-12deg);
  transform-origin: left;
  color: #fff;
  line-height: 0.9;
}
.small {
  font-size: 4cqh;
  font-weight: 900;
  letter-spacing: 0.4em;
  color: #0b0b0b;
  background: #f5ead6;
  display: inline-block;
  padding: 0.3cqh 1.2cqw;
  opacity: 0;
  animation: pop-plain 0.25s ease 0.45s forwards;
}
.big {
  font-size: 16cqh;
  font-weight: 900;
  font-style: italic;
  letter-spacing: -0.03em;
  text-shadow:
    0.6cqw 0.6cqh 0 #e2683a,
    1.2cqw 1.2cqh 0 #0b0b0b;
}
.big span {
  display: inline-block;
  opacity: 0;
  animation: letter 0.3s cubic-bezier(0.3, 1.8, 0.5, 1) calc(0.55s + var(--i) * 0.05s) forwards;
}
.big span:nth-child(odd) {
  --tilt: -8deg;
  --size: 1.08;
}
.big span:nth-child(even) {
  --tilt: 6deg;
  --size: 0.92;
}
@keyframes letter {
  from {
    opacity: 0;
    transform: translateY(-6cqh) rotate(30deg) scale(0.4);
  }
  to {
    opacity: 1;
    transform: rotate(var(--tilt)) scale(var(--size));
  }
}
.track {
  margin-top: 1.5cqh;
  font-size: 2.6cqh;
  font-weight: 700;
  color: #f5ead6;
  opacity: 0;
  animation: fade 0.4s ease 1s forwards;
}

.burst {
  position: absolute;
  right: 8%;
  top: 8%;
  width: 26cqh;
  height: 26cqh;
  display: flex;
  align-items: center;
  justify-content: center;
  clip-path: polygon(50% 0, 61% 30%, 95% 25%, 72% 50%, 95% 75%, 61% 70%, 50% 100%, 39% 70%, 5% 75%, 28% 50%, 5% 25%, 39% 30%);
  background: #f5ead6;
  opacity: 0;
  animation: burst 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) 0.9s forwards;
}
.burst span {
  font-size: 13cqh;
  font-weight: 900;
  font-style: italic;
  color: #0b0b0b;
}
.rank-S {
  background: #fbbf77;
}
@keyframes burst {
  from {
    opacity: 0;
    transform: rotate(-90deg) scale(0);
  }
  to {
    opacity: 1;
    transform: rotate(10deg) scale(1);
  }
}

.cards {
  position: absolute;
  right: 6%;
  bottom: 12%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1.2cqh;
}
.card {
  display: flex;
  align-items: baseline;
  gap: 2cqw;
  padding: 1cqh 2.5cqw;
  background: #0b0b0b;
  color: #fff;
  transform: skewX(-14deg) translateX(60cqw);
  border-left: 0.8cqw solid #f5ead6;
  animation: card 0.35s cubic-bezier(0.2, 0.9, 0.3, 1) calc(1s + var(--d) * 0.12s) forwards;
}
.card.accent {
  background: #f5ead6;
  color: #0b0b0b;
  border-left-color: #0b0b0b;
}
.card i {
  font-style: normal;
  font-size: 1.9cqh;
  font-weight: 800;
  letter-spacing: 0.2em;
  opacity: 0.7;
}
.card b {
  font-size: 4.6cqh;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  min-width: 16cqw;
  text-align: right;
}
@keyframes card {
  to {
    transform: skewX(-14deg) translateX(0);
  }
}
.record {
  position: absolute;
  left: 7%;
  bottom: 9%;
  font-size: 3.2cqh;
  font-weight: 900;
  font-style: italic;
  color: #0b0b0b;
  background: #f5ead6;
  padding: 0.5cqh 2cqw;
  transform: rotate(-12deg);
  opacity: 0;
  animation:
    pop 0.3s ease 1.7s forwards,
    wobble 0.6s ease-in-out 2s infinite alternate;
}
@keyframes wobble {
  to {
    transform: rotate(-9deg) scale(1.05);
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: rotate(-12deg) scale(0.5);
  }
  to {
    opacity: 1;
    transform: rotate(-12deg) scale(1);
  }
}
@keyframes pop-plain {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes fade {
  to {
    opacity: 1;
  }
}
</style>
