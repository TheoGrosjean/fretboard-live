<script setup>
// Onglets par adresse : /#theorie (cours), /#morceaux (tablatures), /#ampli (simulateur d'ampli), /#compare (finitions du corps), sinon le manche.
// Les pages restent en mémoire (KeepAlive) : l'ampli allumé continue de jouer sur le Manche et en mode jeu.
import { computed, onBeforeUnmount, shallowRef } from 'vue'
import App from './App.vue'
import Amp from './Amp.vue'
import Compare from './Compare.vue'
import Theory from './Theory.vue'
import Songs from './Songs.vue'
import TopBar from './components/TopBar.vue'

const PAGES = { '#theorie': Theory, '#morceaux': Songs, '#ampli': Amp, '#compare': Compare }
const pageFor = (hash) => PAGES[hash] ?? App
const page = shallowRef(pageFor(location.hash))
// L'animation de chargement du manche ne se joue qu'à l'ouverture du site sur le Manche
const skipSplash = page.value !== App

const TAB_IDS = new Map([[App, 'manche'], [Theory, 'theorie'], [Songs, 'morceaux'], [Amp, 'ampli']])
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
