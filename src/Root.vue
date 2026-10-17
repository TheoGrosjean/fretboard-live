<script setup>
// Onglets par adresse : /#ampli (simulateur d'ampli), /#compare (finitions du corps), sinon le manche.
// Les pages restent en mémoire (KeepAlive) : l'ampli allumé continue de jouer sur le Manche et en mode jeu.
import { onBeforeUnmount, shallowRef } from 'vue'
import App from './App.vue'
import Amp from './Amp.vue'
import Compare from './Compare.vue'

const PAGES = { '#ampli': Amp, '#compare': Compare }
const pageFor = (hash) => PAGES[hash] ?? App
const page = shallowRef(pageFor(location.hash))
// L'animation de chargement du manche ne se joue qu'à l'ouverture du site sur le Manche
const skipSplash = page.value !== App

// Changement d'onglet : PageTabs a lancé le fondu de sortie (.page-leave), on bascule puis fondu d'entrée
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
  <KeepAlive>
    <component :is="page" v-bind="page === App ? { skipSplash } : {}" />
  </KeepAlive>
</template>
