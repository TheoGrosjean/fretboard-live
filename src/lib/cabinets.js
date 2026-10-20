/**
 * Baffles de guitare synthétiques : réponse impulsionnelle calculée à partir d'un modèle de haut-parleur.
 *
 * Pour chaque baffle on dessine la réponse en fréquence d'un haut-parleur repris au micro :
 *  - résonance grave du baffle (plus marquée en baffle fermé), chute sous la résonance ;
 *  - bosses et creux caractéristiques du haut-parleur dans les médiums ;
 *  - « breakup » du cône : pics et creux irréguliers entre 1,2 et 6 kHz (c'est ce qui donne du caractère) ;
 *  - chute raide au-dessus de 5 kHz ;
 *  - micro : au centre du cône = brillant, vers le bord = plus rond ; de près = effet de proximité dans le grave,
 *    de loin = moins de grave et un léger filtrage en peigne (réflexion sur le sol).
 * La courbe est convertie en réponse impulsionnelle à phase minimale (comme une vraie captation), puis
 * mise à niveau pour que changer de baffle ne change pas le volume.
 */

export const CABINETS = [
  { id: '1x12', name: '1×12 ouvert', sub: 'américain, brillant' },
  { id: '2x12', name: '2×12', sub: 'carillonnant' },
  { id: '4x12', name: '4×12 fermé', sub: 'britannique, gros grave' },
]
export const DEFAULT_CABINET = '4x12'
export const DEFAULT_MIC = { position: 0.15, distance: 0.2 } // 0 = centre / près, 1 = bord / loin

const FFT_SIZE = 8192
const IR_LENGTH = 4096 // ~85 ms à 48 kHz : largement assez pour un baffle

// ---------- Briques de la réponse en fréquence (en dB) ----------
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9))
const highpass = (f, fc, q) => {
  const r = f / fc
  return db((r * r) / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2))
}
const lowpass = (f, fc, q) => {
  const r = f / fc
  return db(1 / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2))
}
/** Bosse (ou creux) en cloche sur une échelle en octaves. */
const bump = (f, fc, gain, octaves) => gain * Math.exp(-0.5 * (Math.log2(f / fc) / (octaves / 2.355)) ** 2)
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Générateur pseudo-aléatoire déterministe : un baffle sonne toujours pareil. */
function seeded(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** Breakup du cône : série de pics et creux irréguliers dans le haut-médium. */
function breakup(seed, amount) {
  const rnd = seeded(seed)
  return Array.from({ length: 14 }, () => ({
    fc: 1200 * 2 ** (rnd() * Math.log2(6500 / 1200)),
    gain: (rnd() * 2 - 1) * amount,
    octaves: 0.08 + rnd() * 0.22,
  }))
}

// Voix de chaque haut-parleur
const MODELS = {
  // Combo américain ouvert : grave léger (le dos ouvert annule le très grave), médiums creusés, aigus brillants
  '1x12': {
    lowCut: [82, 0.8],
    shape: [[120, 2.5, 0.9], [55, -3, 1.2], [500, -3.5, 1.4], [2200, 3, 0.8], [3700, 6, 0.7]],
    highCut: 7800,
    breakup: breakup(7, 3),
  },
  // 2×12 alnico : grave rond, carillon vers 3 kHz
  '2x12': {
    lowCut: [78, 1.0],
    shape: [[125, 3.5, 0.8], [900, 2.5, 1.1], [3000, 6, 0.8], [4600, 4.5, 0.6]],
    highCut: 7800,
    breakup: breakup(23, 3.5),
  },
  // 4×12 fermé : résonance grave marquée (« thump »), bosse de présence, aigus coupés plus tôt
  '4x12': {
    lowCut: [70, 1.1],
    shape: [[105, 3, 0.6], [250, 1, 1], [800, 1, 0.8], [1600, -2, 0.4], [2400, 4.5, 0.6], [3600, 3, 0.6]],
    highCut: 6000,
    breakup: breakup(41, 4),
  },
}

/** Réponse en fréquence (dB) du baffle repris au micro, à la fréquence f. */
function responseDb(f, model, { position, distance }) {
  const m = MODELS[model] ?? MODELS[DEFAULT_CABINET]
  let g = highpass(f, m.lowCut[0], m.lowCut[1])
  for (const [fc, gain, oct] of m.shape) g += bump(f, fc, gain, oct)
  for (const b of m.breakup) g += bump(f, b.fc, b.gain * (1 - 0.5 * position), b.octaves)
  // Aigus : coupés plus tôt quand le micro va vers le bord du cône, et encore un peu de loin
  const highCut = m.highCut * (1 - 0.2 * position)
  g += 2 * lowpass(f, highCut, 0.75) // 4e ordre
  g -= 4 * position * smoothstep(1500, 5000, f)
  g -= 2 * distance * smoothstep(3000, 7000, f)
  // Grave : effet de proximité de près, moins de grave de loin
  g += bump(f, 150, 3 * (1 - distance) - 2 * distance, 1.5)
  // Réflexion sur le sol : léger filtrage en peigne, plus marqué de loin
  const tau = (0.4 + 1.6 * distance) / 1000
  const r = 0.12 + 0.22 * distance
  g += db(Math.sqrt(1 + r * r + 2 * r * Math.cos(2 * Math.PI * f * tau)))
  return g
}

// ---------- FFT (radix 2, en place) ----------
function fft(re, im, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        ;[cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr]
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n)
}

/** Réponse impulsionnelle à phase minimale à partir d'un module (linéaire) sur tout le spectre (méthode du cepstre). */
function minimumPhase(magnitude) {
  const n = magnitude.length
  const re = Float64Array.from(magnitude, (m) => Math.log(Math.max(m, 1e-9)))
  const im = new Float64Array(n)
  fft(re, im, true) // cepstre réel
  for (let i = 1; i < n / 2; i++) (re[i] *= 2), (re[n - i] = 0), (im[i] = 0), (im[n - i] = 0)
  im[0] = 0
  im[n / 2] = 0
  fft(re, im) // log du spectre à phase minimale
  for (let i = 0; i < n; i++) {
    const e = Math.exp(re[i])
    ;[re[i], im[i]] = [e * Math.cos(im[i]), e * Math.sin(im[i])]
  }
  fft(re, im, true)
  return re
}

/** Gain moyen (linéaire) entre 300 Hz et 3 kHz d'une réponse impulsionnelle : sert à égaliser les volumes. */
function bandGain(ir, sampleRate) {
  const re = new Float64Array(FFT_SIZE)
  re.set(ir.subarray(0, FFT_SIZE))
  const im = new Float64Array(FFT_SIZE)
  fft(re, im)
  let sum = 0
  let count = 0
  for (let k = 1; k < FFT_SIZE / 2; k++) {
    const f = (k * sampleRate) / FFT_SIZE
    if (f < 300 || f > 3000) continue
    sum += Math.hypot(re[k], im[k])
    count++
  }
  return sum / count
}

/** Réponse impulsionnelle (AudioBuffer mono) d'un baffle synthétique, avec la position du micro. */
export function cabinetImpulse(ctx, model, mic = DEFAULT_MIC) {
  const sr = ctx.sampleRate
  const magnitude = new Float64Array(FFT_SIZE)
  for (let k = 0; k <= FFT_SIZE / 2; k++) {
    const f = Math.max(10, (k * sr) / FFT_SIZE)
    const m = 10 ** (responseDb(f, model, mic) / 20)
    magnitude[k] = m
    if (k > 0 && k < FFT_SIZE / 2) magnitude[FFT_SIZE - k] = m
  }
  const full = minimumPhase(magnitude)
  const ir = new Float32Array(IR_LENGTH)
  for (let i = 0; i < IR_LENGTH; i++) {
    const fade = i < IR_LENGTH * 0.7 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - IR_LENGTH * 0.7)) / (IR_LENGTH * 0.3)))
    ir[i] = full[i] * fade
  }
  return toBuffer(ctx, ir)
}

/** Réponse impulsionnelle chargée depuis un fichier .wav (premier canal, 1 s max), mise au même niveau. */
export async function loadImpulse(ctx, arrayBuffer) {
  const decoded = await ctx.decodeAudioData(arrayBuffer)
  const data = decoded.getChannelData(0).slice(0, Math.min(decoded.length, ctx.sampleRate))
  return toBuffer(ctx, data)
}

function toBuffer(ctx, ir) {
  const gain = bandGain(ir, ctx.sampleRate) || 1
  const buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate)
  const out = buffer.getChannelData(0)
  for (let i = 0; i < ir.length; i++) out[i] = ir[i] / gain
  return buffer
}

/** Courbe de réponse (dB) pour l'affichage : [{ f, db }] de 60 Hz à 12 kHz. */
export function responseCurve(model, mic = DEFAULT_MIC, points = 80) {
  return Array.from({ length: points }, (_, i) => {
    const f = 60 * (12000 / 60) ** (i / (points - 1))
    return { f, db: responseDb(f, model, mic) }
  })
}
