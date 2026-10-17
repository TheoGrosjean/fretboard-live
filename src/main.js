import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Amp from './Amp.vue'
import Compare from './Compare.vue'

// Onglets par adresse : /#ampli (simulateur d'ampli, en test), /#compare (finitions du corps), sinon le manche
const PAGES = { '#ampli': Amp, '#compare': Compare }
// Arrivée par un changement d'onglet (et non à l'ouverture du site) : pas d'animation de chargement
let fromTabSwitch = false
try {
  fromTabSwitch = sessionStorage.getItem('fb.tabSwitch') === '1'
  sessionStorage.removeItem('fb.tabSwitch')
} catch {}

// Fondu d'entrée quand on arrive d'un autre onglet
if (fromTabSwitch) {
  document.documentElement.classList.add('page-enter')
  setTimeout(() => document.documentElement.classList.remove('page-enter'), 600)
}

const page = PAGES[location.hash] ?? App
createApp(page, page === App ? { skipSplash: fromTabSwitch } : null).mount('#app')

// Changer d'onglet recharge la page : chacun ouvre sa propre entrée audio.
// On le signale pour ne pas rejouer l'animation de chargement du manche.
window.addEventListener('hashchange', () => {
  try {
    sessionStorage.setItem('fb.tabSwitch', '1')
  } catch {}
  location.reload()
})
