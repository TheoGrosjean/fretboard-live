/**
 * Bibliothèque de tablatures Guitar Pro (.gp, .gpx, .gp5, .gp4, .gp3), gardée dans le navigateur (IndexedDB) :
 * les fichiers ne sont jamais envoyés en ligne.
 *
 * Chaque morceau : { id, file, size, addedAt, data (ArrayBuffer), title, artist, album, tempo, bars, seconds, tracks }
 * tracks : [{ index, name, percussion, notes, strings, tuning }] — tuning en notes MIDI, de la corde aiguë à la grave.
 * La lecture des fichiers passe par alphaTab, chargé seulement quand on en a besoin (bibliothèque volumineuse).
 */

export const ACCEPT = '.gp,.gpx,.gp5,.gp4,.gp3'
const DB_NAME = 'fretboard-songs'
const STORE = 'songs'
const TICKS_PER_QUARTER = 960

let dbPromise = null
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}
async function tx(mode, fn) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise((resolve, reject) => {
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Lit un fichier Guitar Pro : renvoie la partition alphaTab (lève une erreur si le fichier n'est pas lisible). */
export async function parseScore(data) {
  const { importer, Settings } = await import('@coderline/alphatab')
  return importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data), new Settings())
}

/** Durée approximative (sans les reprises), en suivant les changements de tempo. */
function scoreSeconds(score) {
  let tempo = score.tempo || 120
  let seconds = 0
  for (const bar of score.masterBars) {
    if (bar.tempoAutomations?.length) tempo = bar.tempoAutomations.at(-1).value
    seconds += (bar.calculateDuration() / TICKS_PER_QUARTER) * (60 / tempo)
  }
  return seconds
}

function summary(score) {
  return {
    title: score.title?.trim() || '',
    artist: score.artist?.trim() || '',
    album: score.album?.trim() || '',
    tempo: Math.round(score.tempo || 0),
    bars: score.masterBars.length,
    seconds: Math.round(scoreSeconds(score)),
    tracks: score.tracks.map((t, index) => {
      let notes = 0
      for (const staff of t.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) notes += beat.notes.length
      const tuning = t.staves[0]?.tuning ?? []
      return { index, name: t.name?.trim() || `Piste ${index + 1}`, percussion: t.isPercussion, notes, strings: tuning.length, tuning: [...tuning] }
    }),
  }
}

export const listSongs = async () => (await tx('readonly', (s) => s.getAll())).sort((a, b) => b.addedAt - a.addedAt)
export const getSong = (id) => tx('readonly', (s) => s.get(id))
export const deleteSong = (id) => tx('readwrite', (s) => s.delete(id))

/** Importe un fichier : le lit, puis l'enregistre avec son résumé. Renvoie le morceau enregistré. */
export async function importSong(file) {
  let data
  try {
    data = await file.arrayBuffer()
  } catch {
    throw new Error(`Impossible de lire « ${file.name} » sur ton ordinateur.`)
  }
  let score
  try {
    score = await parseScore(data)
  } catch {
    throw new Error(`« ${file.name} » n'est pas un fichier Guitar Pro lisible.`)
  }
  const song = { id: crypto.randomUUID(), file: file.name, size: file.size, addedAt: Date.now(), data, ...summary(score) }
  if (!song.title) song.title = file.name.replace(/\.[^.]+$/, '')
  await tx('readwrite', (s) => s.put(song))
  return song
}
