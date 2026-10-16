<script setup>
// Finisher « jeu de combat » : flash, secousse, bandeau qui tranche l'écran en biais,
// mot d'impact écrasé, rang qui tombe comme un tampon, puis les stats.
import { formatScore, useCountUp } from './useCountUp'

const props = defineProps({
  result: { type: Object, required: true }, // voir sessionResult() dans lib/finisher.js
  freezeAt: { type: Number, default: null }, // ms : fige le score (aperçus)
})
defineEmits(['close'])

const score = useCountUp(props.result.score, { delay: 1300, duration: 1100, freezeAt: props.freezeAt })
</script>

<template>
  <div class="finisher absolute inset-0 cursor-pointer overflow-hidden" @click="$emit('close')">
    <div class="shake absolute inset-0">
      <div class="dim absolute inset-0" />

      <!-- Trait de sabre puis bandeau -->
      <div class="slash" />
      <div class="band">
        <div class="stripes" />
        <div class="word">{{ result.word }}</div>
      </div>

      <!-- Rang en tampon -->
      <div class="stamp" :class="`rank-${result.rank}`">
        <span class="label">RANG</span>
        <span class="letter">{{ result.rank }}</span>
      </div>

      <!-- Stats -->
      <div class="stats">
        <div class="track">{{ result.title }} <span>· {{ result.artist }}</span></div>
        <div class="row">
          <div class="stat" style="--d: 0">
            <b>{{ formatScore(score) }}</b>
            <i>score</i>
          </div>
          <div class="stat" style="--d: 1">
            <b>{{ result.bestCombo }}</b>
            <i>meilleur combo</i>
          </div>
          <div class="stat" style="--d: 2">
            <b>{{ result.accuracy }} %</b>
            <i>précision</i>
          </div>
          <div class="stat" style="--d: 3">
            <b>{{ result.style }}</b>
            <i>ton style</i>
          </div>
        </div>
        <div v-if="result.newRecord" class="record">NOUVEAU RECORD</div>
      </div>
      <div class="hint">clique pour continuer</div>
    </div>
    <div class="flash absolute inset-0" />
  </div>
</template>

<style scoped>
.finisher {
  container-type: size;
  font-family: inherit;
}
.flash {
  background: #fff;
  pointer-events: none;
  animation: flash 0.35s ease-out forwards;
}
@keyframes flash {
  from {
    opacity: 0.95;
  }
  to {
    opacity: 0;
  }
}
.shake {
  animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) 0.1s;
}
@keyframes shake {
  20%,
  60% {
    transform: translate(-1.2cqw, 0.6cqh);
  }
  40%,
  80% {
    transform: translate(1.2cqw, -0.6cqh);
  }
}
.dim {
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.9));
  opacity: 0;
  animation: fade 0.3s ease forwards;
}

/* Trait lumineux qui précède le bandeau */
.slash {
  position: absolute;
  left: -10%;
  right: -10%;
  top: 40%;
  height: 0.6cqh;
  background: linear-gradient(90deg, transparent, #fff, var(--color-copper-400), transparent);
  transform: rotate(-7deg) scaleX(0);
  transform-origin: left;
  animation: slash 0.22s ease-in 0.08s forwards;
  filter: drop-shadow(0 0 1.5cqw var(--color-copper-400));
}
@keyframes slash {
  80% {
    opacity: 1;
  }
  to {
    transform: rotate(-7deg) scaleX(1);
    opacity: 0;
  }
}

.band {
  position: absolute;
  left: -10%;
  right: -10%;
  top: 27%;
  height: 26cqh;
  transform: rotate(-7deg);
  background: #0b0b0b;
  border-top: 0.8cqh solid var(--color-copper-500);
  border-bottom: 0.8cqh solid var(--color-copper-500);
  box-shadow: 0 2cqh 6cqh rgba(0, 0, 0, 0.8);
  clip-path: inset(0 100% 0 0);
  animation: wipe 0.28s cubic-bezier(0.7, 0, 0.3, 1) 0.22s forwards;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
@keyframes wipe {
  to {
    clip-path: inset(0 0 0 0);
  }
}
.stripes {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(-60deg, transparent 0 3cqw, color-mix(in srgb, var(--color-copper-500) 12%, transparent) 3cqw 4cqw);
  animation: stripes 1.2s linear infinite;
}
@keyframes stripes {
  to {
    background-position: 8cqw 0;
  }
}
.word {
  position: relative;
  font-size: 15cqh;
  font-weight: 900;
  font-style: italic;
  letter-spacing: -0.02em;
  color: #fff;
  -webkit-text-stroke: 0.25cqh var(--color-copper-500);
  text-shadow:
    0.8cqw 0.8cqh 0 var(--color-copper-600),
    0 0 4cqw color-mix(in srgb, var(--color-copper-400) 60%, transparent);
  opacity: 0;
  animation:
    slam 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) 0.42s forwards,
    jitter 0.08s linear 0.85s 6;
}
@keyframes slam {
  from {
    opacity: 0;
    transform: scale(3);
    filter: blur(1cqw);
  }
  to {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
  }
}
@keyframes jitter {
  50% {
    transform: translate(0.3cqw, -0.2cqh);
  }
}

/* Tampon du rang */
.stamp {
  position: absolute;
  right: 9%;
  top: 9%;
  width: 18cqh;
  height: 18cqh;
  border: 0.8cqh solid currentColor;
  border-radius: 1.5cqh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transform: rotate(12deg);
  opacity: 0;
  animation: stamp 0.35s cubic-bezier(0.3, 1.6, 0.5, 1) 1s forwards;
  background: rgba(0, 0, 0, 0.6);
}
.stamp .label {
  font-size: 2.2cqh;
  font-weight: 800;
  letter-spacing: 0.3em;
}
.stamp .letter {
  font-size: 12cqh;
  font-weight: 900;
}
.rank-S {
  color: var(--color-copper-300);
  filter: drop-shadow(0 0 2cqh color-mix(in srgb, var(--color-copper-300) 70%, transparent));
}
.rank-A {
  color: var(--color-copper-400);
}
.rank-B {
  color: #d6d3d1;
}
.rank-C {
  color: #78716c;
}
@keyframes stamp {
  from {
    opacity: 0;
    transform: rotate(12deg) scale(2.5);
  }
  to {
    opacity: 1;
    transform: rotate(-8deg) scale(1);
  }
}

.stats {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12%;
  text-align: center;
  color: #e7e5e4;
}
.track {
  font-size: 2.6cqh;
  font-weight: 700;
  opacity: 0;
  animation: rise 0.4s ease 1.2s forwards;
}
.track span {
  font-weight: 400;
  color: #a8a29e;
}
.row {
  margin-top: 2cqh;
  display: flex;
  justify-content: center;
  gap: 5cqw;
}
.stat {
  display: flex;
  flex-direction: column;
  opacity: 0;
  animation: rise 0.4s ease calc(1.3s + var(--d) * 0.12s) forwards;
}
.stat b {
  font-size: 5cqh;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.stat i {
  font-style: normal;
  font-size: 1.9cqh;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #a8a29e;
}
.record {
  margin-top: 2cqh;
  display: inline-block;
  padding: 0.6cqh 2cqw;
  font-size: 2.4cqh;
  font-weight: 900;
  letter-spacing: 0.25em;
  color: #0b0b0b;
  background: var(--color-copper-400);
  opacity: 0;
  animation:
    rise 0.3s ease 2s forwards,
    blink 0.8s steps(2) 2.3s infinite;
}
@keyframes blink {
  50% {
    background: #fff;
  }
}
.hint {
  position: absolute;
  bottom: 3%;
  width: 100%;
  text-align: center;
  font-size: 1.8cqh;
  color: #78716c;
  opacity: 0;
  animation: fade 0.5s ease 2.6s forwards;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(2cqh);
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
