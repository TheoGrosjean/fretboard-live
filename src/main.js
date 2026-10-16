import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Compare from './Compare.vue'
import LoaderCompare from './LoaderCompare.vue'

// Pages de comparaison : /#compare (finitions du corps), /#loaders (animations de chargement)
const pages = { '#compare': Compare, '#loaders': LoaderCompare }
createApp(pages[location.hash] ?? App).mount('#app')
