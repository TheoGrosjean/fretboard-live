import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Amp from './Amp.vue'
import Compare from './Compare.vue'

// Onglets par adresse : /#ampli (simulateur d'ampli, en test), /#compare (finitions du corps), sinon le manche
const PAGES = { '#ampli': Amp, '#compare': Compare }
createApp(PAGES[location.hash] ?? App).mount('#app')

// Changer d'onglet recharge la page : chacun ouvre sa propre entrée audio
window.addEventListener('hashchange', () => location.reload())
