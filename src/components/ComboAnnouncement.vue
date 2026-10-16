<script setup>
// Annonces du combo (paliers, combo perdu, sensations de fin de phrase), affichées en grand
// au centre du manche, en surimpression qui ne bloque pas les clics
defineProps({
  announcement: { type: Object, default: null }, // { id, text, tone, sub?, effect? } — voir useCombo
})

const TONES = {
  copper: 'text-copper-300',
  fire: 'fire-text',
  warn: 'text-amber-300',
  danger: 'text-rose-400',
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
    <!-- Sensation de fin de phrase : chaque lettre est animée selon l'effet de la sensation -->
    <div v-if="announcement?.effect" :key="announcement.id" class="fx text-center" :class="`fx-${announcement.effect}`">
      <div class="word text-6xl font-black tracking-tight xl:text-7xl">
        <span v-for="(ch, i) in announcement.text" :key="i" class="ch" :style="{ '--i': i }">{{ ch === ' ' ? '\u00a0' : ch }}</span>
      </div>
      <div class="sub mt-2 text-base font-medium text-neutral-300 xl:text-lg">{{ announcement.sub }}</div>
    </div>
    <!-- Autres annonces (paliers, combo perdu…) -->
    <!-- Le texte est dans un enfant : il passe au-dessus du voile (::before), même avec un dégradé -->
    <div v-else-if="announcement" :key="announcement.id" class="announce text-center text-5xl font-black tracking-tight xl:text-6xl">
      <span :class="TONES[announcement.tone]">{{ announcement.text }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Voile sombre derrière le texte, pour qu'il reste lisible au-dessus des notes du manche
   (pseudo-élément : le texte garde sa propre propriété background, ex. dégradés « en feu » / reflet) */
.announce,
.fx {
  position: relative;
  isolation: isolate;
}
.announce::before,
.fx::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(ellipse 50% 60% at center, rgba(13, 11, 9, 0.9) 40%, rgba(13, 11, 9, 0) 100%);
}
.fire-text {
  background: linear-gradient(90deg, #f0956a, #f97316, #ef4444);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  /* Avec un texte en dégradé, text-shadow passerait par-dessus : on utilise une ombre de forme */
  text-shadow: none;
  filter: drop-shadow(0 0 14px rgba(239, 68, 68, 0.55));
}
.announce,
.fx .word {
  white-space: nowrap;
}

.announce {
  padding: 24px 80px;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
  animation: pop 1.6s ease-out forwards;
}
@keyframes pop {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  15% {
    opacity: 1;
    transform: scale(1.1);
  }
  25% {
    transform: scale(1);
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-10px);
  }
}

/* ---------- Sensations de fin de phrase ---------- */
.fx {
  padding: 28px 80px;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.85);
  animation: fx-life 2.6s ease forwards;
}
@keyframes fx-life {
  0% {
    opacity: 0;
  }
  6%,
  82% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.fx .ch {
  display: inline-block;
}
.fx .sub {
  opacity: 0;
  animation: sub-in 0.5s ease 0.35s forwards;
}
@keyframes sub-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 1 · Résolution : les lettres tombent et se posent, halo doré */
.fx-settle .word {
  color: #fde3c8;
  text-shadow:
    0 0 18px rgba(240, 149, 106, 0.7),
    0 4px 24px rgba(0, 0, 0, 0.85);
}
.fx-settle .ch {
  opacity: 0;
  animation: settle 0.7s cubic-bezier(0.2, 1.4, 0.4, 1) calc(var(--i) * 45ms) forwards;
}
@keyframes settle {
  from {
    opacity: 0;
    transform: translateY(-24px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* b2 · Inquiétant : glitch, aberration chromatique */
.fx-glitch .word {
  color: #e5e5e5;
  text-shadow:
    2px 0 rgba(239, 68, 68, 0.85),
    -2px 0 rgba(56, 189, 248, 0.85);
  animation: glitch 0.32s steps(2) infinite;
}
@keyframes glitch {
  0% {
    transform: translate(0);
    clip-path: inset(0 0 0 0);
  }
  25% {
    transform: translate(-3px, 1px);
    clip-path: inset(20% 0 40% 0);
  }
  50% {
    transform: translate(3px, -1px);
    clip-path: inset(0 0 0 0);
  }
  75% {
    transform: translate(-1px, 2px);
    clip-path: inset(55% 0 10% 0);
  }
}

/* 2 · Suspendu : les lettres flottent en vague, aériennes */
.fx-float .word {
  color: #e0ecff;
  letter-spacing: 0.12em;
  font-weight: 700;
}
.fx-float .ch {
  animation: float 1.6s ease-in-out calc(var(--i) * 90ms) infinite alternate;
}
@keyframes float {
  from {
    transform: translateY(6px);
    opacity: 0.6;
  }
  to {
    transform: translateY(-8px);
    opacity: 1;
  }
}

/* b3 · Mélancolique : bleu, les lettres s'affaissent une à une */
.fx-melancholy .word {
  color: #93c5fd;
}
.fx-melancholy .ch {
  animation: droop 2.2s ease-in calc(400ms + var(--i) * 90ms) forwards;
}
@keyframes droop {
  to {
    transform: translateY(14px) rotate(6deg);
    opacity: 0.35;
    filter: blur(1px);
  }
}

/* 3 · Lumineux : reflet qui balaie le texte */
.fx-shine .word {
  background: linear-gradient(100deg, #f5b48f 20%, #fffaf0 45%, #f5b48f 70%);
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  text-shadow: none;
  filter: drop-shadow(0 0 12px rgba(245, 180, 143, 0.6));
  animation: shine 1.4s ease-in-out infinite;
}
@keyframes shine {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}

/* 4 · En attente… : penché, tapé lettre par lettre */
.fx-lean .word {
  color: #e7e5e4;
  transform: skewX(-10deg);
}
.fx-lean .ch {
  opacity: 0;
  animation: type 0.01s linear calc(var(--i) * 80ms) forwards;
}
@keyframes type {
  to {
    opacity: 1;
  }
}

/* b5 · Grinçant : secousses et déformations */
.fx-grind .word {
  color: #fb923c;
  animation: grind 0.12s linear infinite;
}
@keyframes grind {
  0% {
    transform: translate(0) skewX(0);
  }
  25% {
    transform: translate(-2px, 1px) skewX(6deg);
  }
  50% {
    transform: translate(2px, -1px) skewX(-5deg);
  }
  75% {
    transform: translate(-1px, -1px) skewX(3deg);
  }
}

/* 5 · Puissant : impact massif */
.fx-punch .word {
  color: #fff;
  font-size: 1.25em;
  -webkit-text-stroke: 1px #e2683a;
  animation: punch 0.45s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
@keyframes punch {
  from {
    transform: scale(2.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* b6 · Dramatique : rouge sombre, lent zoom, lettres qui s'écartent */
.fx-drama .word {
  color: #dc2626;
  text-shadow:
    0 0 30px rgba(127, 29, 29, 0.9),
    0 6px 30px rgba(0, 0, 0, 0.95);
  animation: drama 2.6s ease-out forwards;
}
@keyframes drama {
  from {
    transform: scale(0.85);
    letter-spacing: -0.05em;
  }
  to {
    transform: scale(1.1);
    letter-spacing: 0.15em;
  }
}

/* 6 · Nostalgique : sépia, italique à empattements, flou qui va et vient */
.fx-vintage .word {
  color: #e7c9a0;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-weight: 700;
  animation: vintage 2.6s ease-in-out forwards;
}
@keyframes vintage {
  0% {
    filter: blur(4px) sepia(1);
  }
  40% {
    filter: blur(0) sepia(0.6);
  }
  100% {
    filter: blur(1.5px) sepia(1);
  }
}

/* b7 · Bluesy : les lettres se balancent comme un pendule */
.fx-swing .word {
  color: #f0956a;
  font-style: italic;
}
.fx-swing .ch {
  transform-origin: 50% 0;
  animation: swing 0.9s ease-in-out calc(var(--i) * 60ms) infinite alternate;
}
@keyframes swing {
  from {
    transform: rotate(-9deg);
  }
  to {
    transform: rotate(9deg);
  }
}

/* 7 · Intrigue : les lettres frémissent puis sont attirées vers le haut, sans se résoudre */
.fx-intrigue .word {
  color: #c4b5fd;
  text-shadow:
    0 0 16px rgba(167, 139, 250, 0.7),
    0 4px 24px rgba(0, 0, 0, 0.85);
}
.fx-intrigue .ch {
  animation:
    tremble 0.09s linear infinite,
    pull-up 1.8s cubic-bezier(0.5, 0, 0.2, 1) calc(500ms + var(--i) * 70ms) forwards;
}
@keyframes tremble {
  50% {
    translate: 0 -1px;
  }
}
@keyframes pull-up {
  to {
    transform: translateY(-16px);
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fx .word,
  .fx .ch {
    animation: none !important;
    opacity: 1 !important;
  }
}
</style>
