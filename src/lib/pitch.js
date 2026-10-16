/**
 * Détecteur de hauteur YIN (de Cheveigné & Kawahara, 2002), adapté à la guitare.
 * Renvoie { freq, clarity } ou null si aucune hauteur fiable n'est trouvée.
 */
export function createYinDetector(sampleRate, bufferSize, { threshold = 0.15, minFreq = 65, maxFreq = 1400 } = {}) {
  const half = Math.floor(bufferSize / 2)
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq))
  const tauMax = Math.min(half - 2, Math.ceil(sampleRate / minFreq))
  const diff = new Float32Array(tauMax + 2)

  return function detect(buf) {
    // 1. Fonction de différence
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0
      for (let i = 0; i < half; i++) {
        const delta = buf[i] - buf[i + tau]
        sum += delta * delta
      }
      diff[tau] = sum
    }

    // 2. Différence moyenne normalisée cumulée
    diff[0] = 1
    let running = 0
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      running += diff[tau]
      diff[tau] = running === 0 ? 1 : (diff[tau] * tau) / running
    }

    // 3. Premier minimum sous le seuil
    let tau = -1
    for (let t = tauMin; t <= tauMax; t++) {
      if (diff[t] < threshold) {
        while (t + 1 <= tauMax && diff[t + 1] < diff[t]) t++
        tau = t
        break
      }
    }
    if (tau === -1) return null

    // 4. Interpolation parabolique pour une précision sub-échantillon
    const x0 = diff[tau - 1]
    const x1 = diff[tau]
    const x2 = diff[tau + 1]
    const denom = x0 + x2 - 2 * x1
    const refined = denom !== 0 ? tau + (x0 - x2) / (2 * denom) : tau

    return { freq: sampleRate / refined, clarity: 1 - x1 }
  }
}
