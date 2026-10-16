import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Compare from './Compare.vue'
import FinisherCompare from './FinisherCompare.vue'

// Pages de comparaison : /#compare (finitions du corps), /#finishers (écrans de fin de morceau)
const pages = { '#compare': Compare, '#finishers': FinisherCompare }
createApp(pages[location.hash] ?? App).mount('#app')
