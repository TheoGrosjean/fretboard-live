// En premier : récupère le retour de connexion Spotify avant que Supabase ne lise l'adresse
import './lib/spotifyAuth'
import { createApp } from 'vue'
import './style.css'
import Root from './Root.vue'

createApp(Root).mount('#app')
