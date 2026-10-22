/**
 * Batterie synthétisée en Web Audio (aucun échantillon à télécharger) : chaque son General MIDI
 * (canal 10 : 36 grosse caisse, 38 caisse claire, 42 charleston…) est fabriqué à la volée.
 *
 *  - grosse caisse et toms : sinus dont la hauteur chute vite, plus un petit clic d'attaque ;
 *  - caisse claire : corps (triangle) + timbre (bruit filtré) ;
 *  - charleston et cymbales : six oscillateurs carrés désaccordés (son métallique « 808 ») + bruit, filtrés dans l'aigu.
 */

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800] // rapports inharmoniques : son de cymbale

export function createDrumKit(ctx, destination = ctx.destination) {
  const out = ctx.createGain()
  out.gain.value = 0.55
  // Compresseur doux : colle les coups ensemble et évite la saturation quand grosse caisse et crash tombent ensemble
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = -12
  glue.ratio.value = 4
  glue.attack.value = 0.005
  glue.release.value = 0.12
  out.connect(glue).connect(destination)

  // Bruit blanc pré-calculé (2 s), relu pour chaque coup
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  /** Enveloppe : attaque quasi immédiate, décroissance exponentielle. */
  function env(t, level, decay) {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay)
    g.connect(out)
    return g
  }
  function noiseSource(t, decay) {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.start(t, Math.random() * 1.5)
    src.stop(t + decay + 0.05)
    return src
  }
  function filter(type, frequency, Q = 0.7) {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = frequency
    f.Q.value = Q
    return f
  }

  function drum(t, level, from, to, decay) {
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(to, t + decay * 0.35)
    osc.connect(env(t, level, decay))
    osc.start(t)
    osc.stop(t + decay + 0.05)
    // Clic d'attaque (la batte / la baguette)
    noiseSource(t, 0.02).connect(filter('highpass', 2500)).connect(env(t, level * 0.25, 0.02))
  }
  function snare(t, level, decay = 0.2) {
    const body = ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(220, t)
    body.frequency.exponentialRampToValueAtTime(160, t + 0.08)
    body.connect(env(t, level * 0.6, 0.11))
    body.start(t)
    body.stop(t + 0.15)
    noiseSource(t, decay).connect(filter('highpass', 1200)).connect(filter('peaking', 3500, 0.8)).connect(env(t, level * 0.7, decay))
  }
  function metal(t, level, decay, low, scale = 1) {
    const g = env(t, level, decay)
    const hp = filter('highpass', low)
    const bp = filter('bandpass', 10000, 0.6)
    hp.connect(bp).connect(g)
    for (const f of METAL) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = f * scale
      o.connect(hp)
      o.start(t)
      o.stop(t + decay + 0.05)
    }
    noiseSource(t, decay).connect(filter('highpass', low)).connect(env(t, level * 0.5, decay))
  }
  function cymbal(t, level, decay) {
    metal(t, level * 0.5, decay, 5000, 1.6)
    noiseSource(t, decay).connect(filter('highpass', 4000)).connect(env(t, level * 0.6, decay))
  }
  function tone(t, level, freqs, decay, type = 'square') {
    const g = env(t, level, decay)
    const bp = filter('bandpass', freqs[0] * 1.5, 1.2)
    bp.connect(g)
    for (const f of freqs) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.connect(bp)
      o.start(t)
      o.stop(t + decay + 0.05)
    }
  }

  const TOMS = { 41: 82, 43: 92, 45: 104, 47: 120, 48: 138, 50: 158 } // du tom basse au tom aigu (Hz)

  /** Joue le son General MIDI `key` à l'instant `t` (secondes du contexte), vélocité 0–127. */
  function hit(key, t, velocity = 100) {
    const v = (velocity / 127) ** 1.4
    if (key === 35 || key === 36) drum(t, v * 1.1, 150, 45, 0.45)
    else if (TOMS[key]) drum(t, v * 0.8, TOMS[key] * 1.6, TOMS[key], 0.4)
    else if (key === 38 || key === 40) snare(t, v)
    else if (key === 37 || key === 31 || key === 33) noiseSource(t, 0.04).connect(filter('bandpass', 1800, 2)).connect(env(t, v * 0.8, 0.04)) // bord de caisse claire
    else if (key === 39) snare(t, v * 0.8, 0.15) // claquement de mains
    else if (key === 42 || key === 44) metal(t, v * 0.35, 0.05, 7000)
    else if (key === 46) metal(t, v * 0.35, 0.35, 7000)
    else if (key === 49 || key === 57 || key === 52) cymbal(t, v * 0.6, 1.6)
    else if (key === 55) cymbal(t, v * 0.5, 0.6) // splash
    else if (key === 51 || key === 59) metal(t, v * 0.3, 0.8, 5000, 1.2) // ride
    else if (key === 53) tone(t, v * 0.35, [520, 780, 1240], 0.9) // cloche de ride
    else if (key === 56) tone(t, v * 0.4, [545, 815], 0.3) // cowbell
    else if (key === 54 || key === 69 || key === 70 || key === 82) noiseSource(t, 0.12).connect(filter('highpass', 7000)).connect(env(t, v * 0.4, 0.12))
    else noiseSource(t, 0.05).connect(filter('bandpass', 1500, 1.5)).connect(env(t, v * 0.4, 0.05)) // percussion inconnue : petit clic
  }

  return { hit, output: out, destroy: () => glue.disconnect() }
}
