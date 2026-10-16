# Fretboard Live

Visualise en temps réel sur un manche de guitare les notes que tu joues, avec gamme ou arpège superposé, accordeur, historique et lecteur Spotify pour les backing tracks.

## Lancer en local

```sh
npm install
npm run dev
```

Ouvre http://127.0.0.1:5173/ (Chrome, Edge ou Firefox ; l'accès au micro/à l'interface audio est demandé au démarrage).

## Spotify (compte Premium)

1. Crée une app sur https://developer.spotify.com/dashboard (Web API + Web Playback SDK).
2. Déclare les URI de redirection :
   - `http://127.0.0.1:5173/` (local)
   - `https://<pseudo>.github.io/fretboard-live/` (en ligne)
3. Local : copie `.env.example` en `.env.local` et renseigne `VITE_SPOTIFY_CLIENT_ID`.
4. En ligne : ajoute la variable de repo `SPOTIFY_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables).

## Déploiement

Chaque push sur `main` construit et publie le site sur GitHub Pages (`.github/workflows/deploy.yml`).
