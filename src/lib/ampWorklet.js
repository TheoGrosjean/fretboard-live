/**
 * Étages à lampes de l'ampli, calculés échantillon par échantillon (AudioWorklet), suréchantillonnés ×4
 * pour éviter l'aliasing (le grésillement numérique des saturations).
 *
 *  - « tube-preamp » : deux triodes à la suite, inversées comme dans un vrai préampli, avec entre elles le
 *    filtrage d'un vrai circuit (capacité de Miller dans l'aigu, condensateur de liaison dans le grave).
 *    Chaque triode se « bloque » un peu après une attaque forte (décalage de polarisation) : le son se tasse
 *    puis respire, et la saturation change de couleur selon la force du médiator.
 *  - « tube-power » : étage de puissance push-pull, avec l'affaissement de l'alimentation (« sag ») :
 *    sur une attaque forte, la tension baisse, le son se compresse et sature plus, puis se rouvre.
 *
 * Fichier autonome (chargé par audioWorklet.addModule) : il ne doit rien importer.
 */

const OS = 4 // facteur de suréchantillonnage
const LP_Q = [0.5098, 0.6013, 0.9, 2.5629] // passe-bas de Butterworth d'ordre 8 (4 biquads)

class Biquad {
  constructor(fc, fs, q) {
    const w = (2 * Math.PI * fc) / fs
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    this.b0 = (1 - cos) / 2 / a0
    this.b1 = (1 - cos) / a0
    this.b2 = this.b0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
    this.z1 = 0
    this.z2 = 0
  }
  run(x) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/** Suréchantillonnage : insertion de zéros + passe-bas, puis passe-bas + décimation. */
class Oversampler {
  constructor(fs) {
    this.up = LP_Q.map((q) => new Biquad(fs * 0.45, fs * OS, q))
    this.down = LP_Q.map((q) => new Biquad(fs * 0.45, fs * OS, q))
    this.buf = new Float64Array(OS)
  }
  up4(x) {
    for (let k = 0; k < OS; k++) {
      let v = k === 0 ? x * OS : 0
      for (let i = 0; i < 4; i++) v = this.up[i].run(v)
      this.buf[k] = v
    }
    return this.buf
  }
  down4() {
    let v = 0
    for (let k = 0; k < OS; k++) {
      v = this.buf[k]
      for (let i = 0; i < 4; i++) v = this.down[i].run(v)
    }
    return v
  }
}

/** Coefficient d'un filtre / suiveur d'enveloppe du 1er ordre de constante de temps `seconds`. */
const coef = (seconds, fs) => 1 - Math.exp(-1 / (seconds * fs))
const onePole = (fc, fs) => 1 - Math.exp((-2 * Math.PI * fc) / fs)

/** Triode : saturation douce et asymétrique (harmoniques paires). */
const triode = (x) => (x >= 0 ? Math.tanh(x) : Math.tanh(1.25 * x) / 1.15)

const BIAS_SHIFT = 0.45 // décalage de polarisation maximal après une attaque forte
const GRID = 0.6 // au-delà, la grille conduit et la triode commence à se bloquer

/** Une triode avec son décalage de polarisation dynamique. */
class Triode {
  constructor(fs) {
    this.env = 0
    this.atk = coef(0.001, fs)
    this.rel = coef(0.07, fs)
  }
  run(u) {
    const e = u > GRID ? u - GRID : 0
    this.env += (e - this.env) * (e > this.env ? this.atk : this.rel)
    const bias = (-BIAS_SHIFT * this.env) / (1 + this.env)
    return -(triode(u + bias) - triode(bias)) // une triode inverse la phase
  }
}

class TubePreamp extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gain1', defaultValue: 3, minValue: 0, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'gain2', defaultValue: 1, minValue: 0, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'tight', defaultValue: 40, minValue: 10, maxValue: 400, automationRate: 'k-rate' }, // liaison (Hz)
    ]
  }
  constructor() {
    super()
    const fs = sampleRate * OS
    this.fs = fs
    this.os = new Oversampler(sampleRate)
    this.v1 = new Triode(fs)
    this.v2 = new Triode(fs)
    this.miller1 = onePole(10000, fs)
    this.miller2 = onePole(6500, fs)
    this.lp1 = 0
    this.lp2 = 0
    this.hp = 0
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0][0]
    const output = outputs[0][0]
    if (!output) return true
    if (!input) {
      output.fill(0)
      return true
    }
    const g1 = parameters.gain1[0]
    const g2 = parameters.gain2[0]
    const hpc = onePole(parameters.tight[0], this.fs)
    const { os, v1, v2, miller1, miller2 } = this
    let { lp1, lp2, hp } = this
    for (let n = 0; n < input.length; n++) {
      const buf = os.up4(input[n])
      for (let k = 0; k < OS; k++) {
        let y = v1.run(buf[k] * g1)
        lp1 += (y - lp1) * miller1 // capacité de Miller : adoucit l'aigu de la 1re triode
        hp += (lp1 - hp) * hpc // condensateur de liaison : resserre le grave avant la 2e triode
        y = v2.run((lp1 - hp) * g2)
        lp2 += (y - lp2) * miller2
        buf[k] = -lp2 // remet la phase d'origine
      }
      output[n] = os.down4()
    }
    Object.assign(this, { lp1, lp2, hp })
    return true
  }
}

class TubePower extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0.6, minValue: 0.01, maxValue: 10, automationRate: 'k-rate' },
      { name: 'sag', defaultValue: 0.3, minValue: 0, maxValue: 0.9, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    const fs = sampleRate * OS
    this.os = new Oversampler(sampleRate)
    this.env = 0
    this.atk = coef(0.005, fs) // l'alimentation s'effondre vite…
    this.rel = coef(0.18, fs) // …et se recharge lentement
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0][0]
    const output = outputs[0][0]
    if (!output) return true
    if (!input) {
      output.fill(0)
      return true
    }
    const d = parameters.drive[0]
    const sag = parameters.sag[0]
    const { os, atk, rel } = this
    let env = this.env
    for (let n = 0; n < input.length; n++) {
      const buf = os.up4(input[n])
      for (let k = 0; k < OS; k++) {
        const u = buf[k] * d
        const a = Math.abs(u)
        env += (a - env) * (a > env ? atk : rel)
        const supply = 1 - (sag * env) / (1 + env) // tension d'alimentation, de 1 à 1 − sag
        // Push-pull : saturation symétrique, plafond qui baisse avec la tension ; le gain baisse un peu aussi
        buf[k] = ((supply * Math.tanh(u / supply)) / d) * (0.75 + 0.25 * supply)
      }
      output[n] = os.down4()
    }
    this.env = env
    return true
  }
}

registerProcessor('tube-preamp', TubePreamp)
registerProcessor('tube-power', TubePower)
