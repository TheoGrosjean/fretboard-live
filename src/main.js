import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Compare from './Compare.vue'

// /#compare : planche de comparaison des finitions du corps
createApp(location.hash === '#compare' ? Compare : App).mount('#app')
