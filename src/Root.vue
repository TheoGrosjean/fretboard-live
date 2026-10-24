<script setup>
// Onglets par adresse : /#profil (compte), /#phrases (entraînement de phrasés), /#theorie (cours), /#ampli (simulateur d'ampli), sinon le manche.
// Les pages restent en mémoire (KeepAlive) : l'ampli allumé continue de jouer sur le Manche et en mode jeu.
// Le Manche est chargé tout de suite, les autres pages à la demande, puis en tâche de fond une fois le site affiché.
import { computed, defineAsyncComponent, onBeforeUnmount, shallowRef } from 'vue'
import App from './App.vue'
import TopBar from './components/TopBar.vue'

const LOADERS = {
  '#profil': () => import('./Profile.vue'),
  '#phrases': () => import('./Phrases.vue'),
  '#theorie': () => import('./Theory.vue'),
  '#ampli': () => import('./Amp.vue'),
}
const PAGES = Object.fromEntries(Object.entries(LOADERS).map(([hash, load]) => [hash, defineAsyncComponent(load)]))
const pageFor = (hash) => PAGES[hash] ?? App
const page = shallowRef(pageFor(location.hash))
// L'animation de chargement du manche ne se joue qu'à l'ouverture du site sur le Manche
const skipSplash = page.value !== App
const later = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500))
later(() => Object.values(LOADERS).forEach((load) => load()))

const TAB_IDS = new Map([[App, 'manche'], ...Object.entries(PAGES).map(([hash, c]) => [c, hash.slice(1)])]) // '#phrases' -> 'phrases'
const current = computed(() => TAB_IDS.get(page.value) ?? '')

// Changement d'onglet : la barre du haut (TopBar) a lancé le fondu de sortie (.page-leave), on bascule puis fondu d'entrée
const html = document.documentElement
let enterTimer = 0
function onHashChange() {
  page.value = pageFor(location.hash)
  html.classList.remove('page-leave')
  html.classList.add('page-enter')
  clearTimeout(enterTimer)
  enterTimer = setTimeout(() => html.classList.remove('page-enter'), 600)
}
addEventListener('hashchange', onHashChange)
onBeforeUnmount(() => removeEventListener('hashchange', onHashChange))
</script>

<template>
  <TopBar :current="current" />
  <div class="page-view">
    <KeepAlive>
      <component :is="page" v-bind="page === App ? { skipSplash } : {}" />
    </KeepAlive>
  </div>
</template>
