/**
 * Autoroute de notes 3D façon Rocksmith (Three.js).
 *
 * Repère : x = cases (1 unité par case), y = cordes (Mi aigu en haut, Mi grave en bas, comme le manche du site),
 * z = temps (0 = maintenant, les notes à venir arrivent depuis z négatif). Les cordes et les frettes sont
 * dessinées à z = 0 ; une note y arrive à sa corde (hauteur + couleur) et au-dessus de sa case.
 * La caméra suit la zone du manche où se trouve la main. Halo (bloom) sur tout ce qui brille.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { STRING_COLORS } from '../../lib/songChart'

const FRETS = 24
const GAP = 0.34 // écart entre deux cordes
const Z_PER_SECOND = 11 // vitesse de défilement (unités par seconde réelle) : notes bien espacées
const AHEAD = 3.2 // secondes visibles à l'avance
const TARGET_LEAD = 0.9 // s : la cible apparaît sur la corde et la case s'allume avant l'arrivée de la note
const BEHIND = 0.3 // une note ratée continue un peu derrière les cordes, en s'effaçant
const FLOOR_Y = -0.55
const COPPER = new THREE.Color('#e2683a')
const COPPER_LIGHT = new THREE.Color('#f0956a')
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]

const fretCenter = (f) => (f <= 0 ? -0.2 : f - 0.5)
const stringY = (s, strings) => (strings - 1 - s) * GAP

/** Texture texte (nombres de case, accords, techniques), mise en cache. */
const textCache = new Map()
function textTexture(text, { color = '#fff', size = 96, weight = 900, glow = null, stroke = 'rgba(0,0,0,0.75)' } = {}) {
  const key = `${text}|${color}|${size}|${weight}|${glow}|${stroke}`
  if (textCache.has(key)) return textCache.get(key)
  const c = document.createElement('canvas')
  const font = `${weight} ${size}px Inter, system-ui, sans-serif`
  const ctx = c.getContext('2d')
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width + size * 0.6)
  c.width = w
  c.height = Math.ceil(size * 1.4)
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (glow) {
    ctx.shadowColor = glow
    ctx.shadowBlur = size * 0.25
  }
  ctx.lineWidth = size * 0.12
  ctx.strokeStyle = stroke
  ctx.strokeText(text, w / 2, c.height / 2)
  ctx.fillStyle = color
  ctx.fillText(text, w / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const entry = { tex, aspect: w / c.height }
  textCache.set(key, entry)
  return entry
}
function textSprite(text, height, opts) {
  const { tex, aspect } = textTexture(text, opts)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }))
  sprite.scale.set(height * aspect, height, 1)
  return sprite
}

/** Faisceau de projecteur : lumineux à la source, qui s'évanouit vers le bas et sur les bords. */
let beamTex = null
function beamTexture() {
  if (beamTex) return beamTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const ctx = c.getContext('2d')
  const v = ctx.createLinearGradient(0, 0, 0, 256)
  v.addColorStop(0, 'rgba(255,255,255,0.9)')
  v.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, 64, 256)
  ctx.globalCompositeOperation = 'destination-in'
  const h = ctx.createLinearGradient(0, 0, 64, 0)
  h.addColorStop(0, 'rgba(0,0,0,0)')
  h.addColorStop(0.5, 'rgba(0,0,0,1)')
  h.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, 64, 256)
  beamTex = new THREE.CanvasTexture(c)
  return beamTex
}

/** Dégradé radial doux (halos, particules). */
let glowTex = null
function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

export class Highway {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#0b0908')
    this.scene.fog = new THREE.Fog('#0b0908', 16, AHEAD * Z_PER_SECOND + 4)
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200)
    this.cameraX = 5
    this.anchorX = 5

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Halo réservé à ce qui est vraiment lumineux (explosions, cordes touchées) : les notes restent nettes
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.4, 0.62)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.scene.add(new THREE.AmbientLight('#ffffff', 0.55))
    const key = new THREE.DirectionalLight('#ffe9d6', 1.6)
    key.position.set(4, 8, 6)
    this.scene.add(key)
    const rim = new THREE.PointLight(COPPER_LIGHT, 14, 30) // lueur cuivrée discrète sur le sol, derrière les cordes
    rim.position.set(0, 3, -6)
    this.rim = rim
    this.scene.add(rim)

    this.strings = 6
    this.notes = [] // partition (temps réels, déjà divisés par la vitesse)
    this.live = new Map() // id -> objet 3D de la note visible
    this.state = new Map() // id -> 'hit' | 'miss' (+ instant)
    this.visible = () => true
    this.effects = [] // explosions de particules en cours
    this.stringFlash = new Array(6).fill(0)
    this.clock = new THREE.Clock()

    this._buildStage()
    this._buildNeck(6)
  }

  // ---------- Décor : sol, lignes de case, projecteurs, poussière ----------
  _buildStage() {
    const depth = AHEAD * Z_PER_SECOND + 10
    // Sol : bois sombre très vernis, qui reçoit la lueur cuivrée des cases à jouer
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FRETS + 6, depth),
      new THREE.MeshStandardMaterial({ color: '#15110e', roughness: 0.45, metalness: 0.4 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(FRETS / 2, FLOOR_Y, -depth / 2 + 3)
    this.scene.add(floor)

    // Couloirs des cases : une ligne par frette, sur toute la profondeur
    const laneMat = new THREE.LineBasicMaterial({ color: '#3a302a', transparent: true, opacity: 0.8 })
    const pts = []
    for (let f = 0; f <= FRETS; f++) pts.push(new THREE.Vector3(f, FLOOR_Y + 0.002, 2), new THREE.Vector3(f, FLOOR_Y + 0.002, -depth))
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), laneMat))

    // Zone de la main : bande cuivrée lumineuse sur le sol, qui glisse avec la caméra
    const zoneMat = new THREE.MeshBasicMaterial({ color: COPPER, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending })
    this.zone = new THREE.Mesh(new THREE.PlaneGeometry(1, depth), zoneMat)
    this.zone.rotation.x = -Math.PI / 2
    this.zone.position.set(5, FLOOR_Y + 0.004, -depth / 2 + 2)
    this.scene.add(this.zone)
    const edgeMat = new THREE.MeshBasicMaterial({ color: COPPER_LIGHT, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })
    this.zoneEdges = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.04, depth), edgeMat)
      m.rotation.x = -Math.PI / 2
      m.position.set(0, FLOOR_Y + 0.006, -depth / 2 + 2)
      this.scene.add(m)
      return m
    })

    // Lignes de temps (réutilisées) : une par temps, plus marquée en début de mesure
    this.beatPool = []
    const beatGeo = new THREE.PlaneGeometry(FRETS + 2, 0.035)
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(beatGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, depthWrite: false }))
      m.rotation.x = -Math.PI / 2
      m.visible = false
      this.scene.add(m)
      this.beatPool.push(m)
    }

    // Projecteurs : faisceaux qui tombent du plafond et balaient doucement l'arrière-scène
    const beamGeo = new THREE.PlaneGeometry(7, 34)
    beamGeo.translate(0, -17, 0) // pivot en haut, à la source de lumière
    this.beams = [-8, 4, 16, 28].map((x, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: i % 2 ? '#f0956a' : '#fbbf24', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
      const beam = new THREE.Mesh(beamGeo, mat)
      beam.position.set(x, 20, -46)
      beam.userData.phase = i * 1.7
      this.scene.add(beam)
      return beam
    })

    // Poussière dans la lumière
    const count = 500
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 40 - 8
      pos[i * 3 + 1] = Math.random() * 10 - 1
      pos[i * 3 + 2] = -Math.random() * 45
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ size: 0.06, map: glowTexture(), color: '#f5b48f', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    this.scene.add(this.dust)
  }

  // ---------- Manche : cordes, frettes, numéros de case ----------
  _buildNeck(strings) {
    if (this.neck) this.scene.remove(this.neck)
    const neck = new THREE.Group()
    this.strings = strings
    const top = stringY(0, strings)

    // Frettes : fils métalliques verticaux
    const fretMat = new THREE.MeshStandardMaterial({ color: '#d6d3d1', metalness: 0.9, roughness: 0.25, emissive: '#3a3330', emissiveIntensity: 0.4 })
    for (let f = 0; f <= FRETS; f++) {
      const w = f === 0 ? 0.09 : 0.035
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, top + 0.3, 0.03), f === 0 ? new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.5 }) : fretMat)
      m.position.set(f, top / 2, -0.02)
      neck.add(m)
    }

    // Cordes : de plus en plus épaisses vers le grave, teintées de leur couleur
    this.stringMeshes = []
    for (let s = 0; s < strings; s++) {
      const color = new THREE.Color(STRING_COLORS[s] ?? '#ffffff')
      const mat = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.15), emissive: color, emissiveIntensity: 0.05, metalness: 0.7, roughness: 0.35 })
      const radius = 0.012 + s * 0.005
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, FRETS + 2, 10), mat)
      m.rotation.z = Math.PI / 2
      m.position.set(FRETS / 2, stringY(s, strings), 0)
      neck.add(m)
      this.stringMeshes.push(m)
    }

    // Numéros de case sous les cordes, et repères (points) aux cases habituelles
    this.fretLabels = []
    for (let f = 1; f <= FRETS; f++) {
      const label = textSprite(String(f), 0.32, { color: '#ffffff', weight: 800 })
      label.material.color.set('#8a8580')
      label.position.set(fretCenter(f), -0.32, 0.05)
      neck.add(label)
      this.fretLabels.push(label)
      if (INLAYS.includes(f)) {
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: f % 12 ? '#a8a29e' : '#f5b48f', transparent: true, depthWrite: false }))
        dot.scale.set(0.18, 0.18, 1)
        dot.position.set(fretCenter(f), -0.6, 0.05)
        neck.add(dot)
      }
    }
    this.neck = neck
    this.scene.add(neck)
  }

  // ---------- Partition ----------
  /** chart : partition (lib/songChart.js) ; offset / speed : temps réel = (temps partition − offset) / speed. */
  setChart(chart, { speed = 1, offset = 0 } = {}) {
    this.chart = chart
    this.speed = speed
    this.offset = offset
    if ((chart.tuning?.length ?? 6) !== this.strings) this._buildNeck(chart.tuning.length)
    this.clearNotes()
    const real = (t) => (t - offset) / speed
    this.notes = chart.notes.map((n) => ({ ...n, t: real(n.time), d: n.dur / speed }))
    this.beats = chart.beats.map((b) => ({ ...b, t: real(b.time) }))
    this.chordById = new Map(chart.chords.map((c) => [c.id, c]))
    this.state.clear()
  }
  /** Notes affichées (difficulté dynamique) : fn(note) => boolean. */
  setVisibility(fn) {
    this.visible = fn
  }
  clearNotes() {
    for (const obj of this.live.values()) this._dispose(obj)
    this.live.clear()
  }
  resetStates() {
    this.state.clear()
    this.clearNotes()
  }

  hit(id, perfect) {
    this.state.set(id, { kind: 'hit', at: this.now, perfect })
    const n = this.notes.find((x) => x.id === id)
    if (!n) return
    const color = new THREE.Color(STRING_COLORS[n.string] ?? '#fff')
    this._burst(new THREE.Vector3(fretCenter(n.fret || this.anchorX), stringY(n.string, this.strings), 0.05), color, perfect ? 46 : 28)
    this.stringFlash[n.string] = 1
  }
  miss(id) {
    this.state.set(id, { kind: 'miss', at: this.now })
  }

  // ---------- Objets 3D d'une note ----------
  _noteObject(n) {
    const group = new THREE.Group()
    const color = new THREE.Color(STRING_COLORS[n.string] ?? '#fff')
    const y = stringY(n.string, this.strings)
    const open = n.fret === 0
    const width = open ? 4 : 0.72
    const x = open ? this.anchorX : fretCenter(n.fret)
    // Pastille : barre arrondie brillante (corde à vide : longue barre sur toute la zone de la main)
    const gemMat = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.12, metalness: 0.05, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.25, transparent: true })
    const gem = new THREE.Mesh(new RoundedBoxGeometry(width, 0.3, 0.16, 3, 0.08), gemMat)
    group.add(gem)
    // Contour sombre : détache la pastille du décor et des autres notes
    const outline = new THREE.Mesh(new RoundedBoxGeometry(width + 0.05, 0.35, 0.12, 3, 0.1), new THREE.MeshBasicMaterial({ color: '#0c0a09', transparent: true, opacity: 0.85 }))
    outline.position.z = -0.03
    group.add(outline)
    // Halo derrière la pastille
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.set(width + 0.4, 0.6, 1)
    group.add(halo)
    // Numéro de case sur la pastille
    const label = textSprite(open ? '0' : String(n.fret), 0.42, { color: '#0c0a09', weight: 900, stroke: 'rgba(255,255,255,0.4)' })
    label.position.set(0, 0, 0.12)
    if (!open) group.add(label)
    // Trait vertical jusqu'au sol, et marque de la case sur le sol (pour lire la case de loin)
    const stemMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false })
    const stem = new THREE.Mesh(new THREE.PlaneGeometry(0.03, y - FLOOR_Y), stemMat)
    stem.position.set(0, -(y - FLOOR_Y) / 2, 0)
    group.add(stem)
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.95, 0.18), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }))
    mark.rotation.x = -Math.PI / 2
    mark.position.set(0, FLOOR_Y - y + 0.01, 0)
    group.add(mark)
    // Note tenue : ruban lumineux derrière la pastille (géométrie de longueur 1, étirée à chaque image)
    let tail = null
    if (n.d > 0.35 && !n.dead) {
      const geo = new THREE.PlaneGeometry(open ? width : 0.16, 1)
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, 0, -0.5) // de 0 à −1 : part de la pastille vers le fond
      tail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }))
      group.add(tail)
    }
    // Techniques : étiquette au-dessus de la pastille
    const tech = n.bend ? `↑${n.bend === 1 ? '½' : n.bend === 2 ? '1' : n.bend / 2}` : n.slide ? (n.slide === 'up' ? `↗${n.slideTo ?? ''}` : `↘${n.slideTo ?? ''}`) : n.hopo ?? (n.palmMute ? 'PM' : n.dead ? '✕' : n.harmonic ? '◆' : n.vibrato ? '〰' : '')
    const texts = open ? [] : [label] // textes qui s'effacent avec la pastille
    if (tech) {
      const t = textSprite(tech, 0.28, { color: '#ffffff', weight: 900, glow: STRING_COLORS[n.string] })
      t.position.set(0, 0.3, 0.05)
      group.add(t)
      texts.push(t)
    }
    if (n.dead) gemMat.emissiveIntensity = 0.15
    group.position.set(x, y, 0)
    // Cible sur la corde, à la case : un cadre qui se resserre quand la note arrive (là où poser le doigt)
    const target = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(width + 0.12, 0.42)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
    )
    const targetGroup = new THREE.Group()
    targetGroup.add(target)
    group.add(targetGroup)
    group.userData = { gem, gemMat, halo, stemMat, tail, outline, target: targetGroup, texts }
    this.scene.add(group)
    return group
  }
  /** Cadre et nom d'un accord. */
  _chordObject(c, notes) {
    const strings = notes.map((n) => n.string)
    const frets = notes.map((n) => n.fret).filter((f) => f > 0)
    const x0 = frets.length ? Math.min(...frets) - 1 : this.anchorX - 2
    const x1 = frets.length ? Math.max(...frets) : this.anchorX + 2
    const y0 = stringY(Math.max(...strings), this.strings) - 0.2
    const y1 = stringY(Math.min(...strings), this.strings) + 0.2
    const group = new THREE.Group()
    const shape = new THREE.EdgesGeometry(new THREE.PlaneGeometry(x1 - x0 + 0.2, y1 - y0))
    const frame = new THREE.LineSegments(shape, new THREE.LineBasicMaterial({ color: '#fde3c8', transparent: true, opacity: 0.85 }))
    group.add(frame)
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 0.2, y1 - y0), new THREE.MeshBasicMaterial({ color: COPPER, transparent: true, opacity: 0.08, depthWrite: false }))
    group.add(fill)
    if (c.name) {
      const label = textSprite(c.name, 0.38, { color: '#fde3c8', weight: 900, glow: '#e2683a' })
      label.position.set(0, (y1 - y0) / 2 + 0.3, 0)
      group.add(label)
    }
    group.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.05)
    this.scene.add(group)
    return group
  }
  _dispose(obj) {
    this.scene.remove(obj)
    obj.traverse((o) => {
      if (!o.isSprite) o.geometry?.dispose() // la géométrie des sprites est partagée par Three.js
      o.material?.dispose() // les textures (texte, halo) sont en cache et restent
    })
  }

  _burst(pos, color, count) {
    const geo = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3)
    const v = []
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3)
      const a = Math.random() * Math.PI * 2
      const speed = 1.5 + Math.random() * 3.5
      v.push(new THREE.Vector3(Math.cos(a) * speed * 0.8, Math.sin(a) * speed * 0.6 + 1.5, Math.random() * 2 + 0.5))
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    // Onde de choc : anneau qui s'agrandit sur la corde
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }))
    ring.position.copy(pos)
    this.scene.add(pts, ring)
    this.effects.push({ pts, ring, v, life: 0 })
  }

  // ---------- Image ----------
  resize(w, h) {
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w / 2, h / 2)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** now : temps réel de la chanson (s, peut être négatif pendant le décompte). */
  render(now) {
    const dt = Math.min(0.05, this.clock.getDelta())
    this.now = now
    const elapsed = this.clock.elapsedTime

    // Zone de la main : moyenne des cases des notes des 2,5 prochaines secondes, lissée
    const upcoming = this.notes.filter((n) => n.t > now - 0.1 && n.t < now + 2.5 && n.fret > 0 && this.visible(n))
    if (upcoming.length) {
      const lo = Math.min(...upcoming.map((n) => n.fret))
      const hi = Math.max(...upcoming.map((n) => n.fret))
      this.anchorX = (Math.max(1, lo - 1) + Math.max(hi, lo + 3)) / 2
      this.zoneLo = Math.max(0, lo - 1)
      this.zoneHi = Math.max(hi, lo + 3)
    }
    this.cameraX += (this.anchorX - this.cameraX) * Math.min(1, dt * 2.2)
    this.camera.position.set(this.cameraX, 4.4, 9.2)
    this.camera.lookAt(this.cameraX, -0.3, -12)
    const zLo = this.zoneLo ?? 2
    const zHi = this.zoneHi ?? 6
    this.zone.scale.x += (zHi - zLo - this.zone.scale.x) * Math.min(1, dt * 4)
    this.zone.position.x += ((zLo + zHi) / 2 - this.zone.position.x) * Math.min(1, dt * 4)
    this.zoneEdges[0].position.x = this.zone.position.x - this.zone.scale.x / 2
    this.zoneEdges[1].position.x = this.zone.position.x + this.zone.scale.x / 2
    // Case qui va être jouée : son numéro grossit et prend la couleur de la corde
    const coming = new Map()
    for (const n of this.notes) {
      if (n.t > now + TARGET_LEAD) break
      if (n.t < now - 0.1 || n.fret === 0 || !this.visible(n) || this.state.has(n.id)) continue
      if (!coming.has(n.fret)) coming.set(n.fret, n.string)
    }
    this.fretLabels.forEach((l, i) => {
      const f = i + 1
      const inZone = f > zLo && f <= zHi
      const hot = coming.has(f)
      l.material.opacity = hot || inZone ? 1 : 0.4
      l.material.color.set(hot ? STRING_COLORS[coming.get(f)] : inZone ? '#e7e5e4' : '#8a8580')
      const h = hot ? 0.5 : inZone ? 0.36 : 0.26
      l.scale.set((h * l.material.map.image.width) / l.material.map.image.height, h, 1)
    })
    this.rim.position.x = this.cameraX

    // Lignes de temps
    let bi = 0
    for (const b of this.beats ?? []) {
      if (b.t < now - 0.2 || b.t > now + AHEAD) continue
      const m = this.beatPool[bi++]
      if (!m) break
      m.visible = true
      m.position.set(FRETS / 2, FLOOR_Y + 0.003, -(b.t - now) * Z_PER_SECOND)
      m.material.opacity = b.bar ? 0.28 : 0.09
      m.scale.y = b.bar ? 1.6 : 1
    }
    for (; bi < this.beatPool.length; bi++) this.beatPool[bi].visible = false

    // Notes : création à l'entrée dans la fenêtre, suppression à la sortie
    const keep = new Set()
    for (const n of this.notes) {
      if (n.t > now + AHEAD) break
      if (n.t + n.d < now - BEHIND || !this.visible(n)) continue
      const st = this.state.get(n.id)
      const sustained = n.d > 0.35 && !n.dead
      // Note réussie : elle disparaît, sauf une note tenue, qui reste sur les cordes jusqu'à la fin de sa durée
      if (st?.kind === 'hit' && now - st.at > 0.25 && (!sustained || now > n.t + n.d)) continue
      keep.add(n.id)
      let obj = this.live.get(n.id)
      if (!obj) {
        obj = this._noteObject(n)
        this.live.set(n.id, obj)
      }
      const z = -(n.t - now) * Z_PER_SECOND
      // Une note réussie reste sur les cordes ; une autre les dépasse à peine, le temps de s'effacer
      obj.position.z = st?.kind === 'hit' ? Math.min(z, 0) : Math.min(z, 0.5)
      const { gemMat, halo, stemMat, tail, outline, target } = obj.userData
      const ahead = n.t - now // secondes avant l'arrivée
      const soon = st ? 0 : Math.max(0, 1 - ahead / TARGET_LEAD) // 0 → 1 pendant l'approche
      // Cible : reste sur les cordes (z = 0) quelle que soit la position de la note
      target.position.z = -obj.position.z
      target.visible = soon > 0 && ahead > -0.05
      target.scale.setScalar(1 + (1 - soon) * 0.8)
      target.children[0].material.opacity = soon * 0.9
      outline.material.opacity = gemMat.opacity
      // Ruban de la note tenue : il est « consommé » en arrivant aux cordes (jamais au-delà)
      if (tail) {
        const back = z - n.d * Z_PER_SECOND // bout du ruban, côté fond
        const front = Math.min(z, 0)
        const len = Math.max(0.001, front - back)
        tail.scale.z = len
        tail.position.z = front - obj.position.z
        tail.visible = front > back
      }
      // Approche : la pastille s'allume en arrivant sur les cordes
      const close = 1 - Math.min(1, Math.abs(n.t - now) / 0.6)
      gemMat.emissiveIntensity = n.dead ? 0.05 : 0.1 + close * 0.3
      if (st?.kind === 'hit') {
        const k = Math.min(1, (now - st.at) / 0.25)
        if (sustained && now < n.t + n.d) {
          // Note tenue : la pastille reste allumée sur la corde et pulse
          obj.scale.setScalar(1 + (1 - k) * 0.5)
          gemMat.emissiveIntensity = 0.6 + Math.sin(now * 30) * 0.15
          halo.material.opacity = 0.45
          this.stringFlash[n.string] = Math.max(this.stringFlash[n.string], 0.5)
        } else {
          obj.scale.setScalar(1 + k * 0.8)
          gemMat.opacity = 1 - k
          halo.material.opacity = 0.6 * (1 - k)
          gemMat.emissive.set('#ffffff')
        }
      } else if (st?.kind === 'miss') {
        gemMat.color.set('#57534e')
        gemMat.emissive.set('#1c1917')
        halo.material.opacity = 0.1
        stemMat.opacity = 0.1
      }
      // Passée les cordes, la note s'efface vite (elle ne fonce pas sur la caméra)
      if (z > 0 && st?.kind !== 'hit') {
        const fade = Math.max(0, 1 - (now - n.t) / 0.25)
        gemMat.opacity = fade
        halo.material.opacity = Math.min(halo.material.opacity, fade * 0.3)
      }
      outline.material.opacity = gemMat.opacity
      for (const t of obj.userData.texts) t.material.opacity = gemMat.opacity
    }
    for (const [id, obj] of this.live) {
      if (!keep.has(id)) {
        this._dispose(obj)
        this.live.delete(id)
      }
    }

    // Accords : cadre au moment où ils passent
    this.chordObjs ??= new Map()
    const chordKeep = new Set()
    for (const c of this.chart?.chords ?? []) {
      const t = (c.time - this.offset) / this.speed
      if (t > now + AHEAD) break
      if (t < now - 0.15) continue
      const notes = c.noteIds.map((id) => this.notes.find((n) => n.id === id)).filter((n) => n && this.visible(n))
      if (notes.length < 2) continue
      chordKeep.add(c.id)
      let obj = this.chordObjs.get(c.id)
      if (!obj) {
        obj = this._chordObject(c, notes)
        this.chordObjs.set(c.id, obj)
      }
      obj.position.z = -(t - now) * Z_PER_SECOND - 0.05
    }
    for (const [id, obj] of this.chordObjs) {
      if (!chordKeep.has(id)) {
        this._dispose(obj)
        this.chordObjs.delete(id)
      }
    }

    // Cordes qui vibrent et s'illuminent quand on touche juste
    this.stringMeshes.forEach((m, s) => {
      const f = this.stringFlash[s]
      m.material.emissiveIntensity = 0.05 + f * 1.4
      m.position.y = stringY(s, this.strings) + Math.sin(elapsed * 90 + s) * 0.012 * f
      this.stringFlash[s] = Math.max(0, f - dt * 2.5)
    })

    // Explosions
    this.effects = this.effects.filter((e) => {
      e.life += dt
      const pos = e.pts.geometry.attributes.position
      for (let i = 0; i < e.v.length; i++) {
        e.v[i].y -= 6 * dt
        pos.array[i * 3] += e.v[i].x * dt
        pos.array[i * 3 + 1] += e.v[i].y * dt
        pos.array[i * 3 + 2] += e.v[i].z * dt
      }
      pos.needsUpdate = true
      e.pts.material.opacity = Math.max(0, 1 - e.life / 0.7)
      e.ring.scale.setScalar(1 + e.life * 9)
      e.ring.material.opacity = Math.max(0, 0.9 - e.life * 2.2)
      if (e.life > 0.7) {
        this._dispose(e.pts)
        this._dispose(e.ring)
        return false
      }
      return true
    })

    // Ambiance : projecteurs qui balaient, poussière qui flotte
    for (const b of this.beams) {
      b.rotation.z = Math.sin(elapsed * 0.25 + b.userData.phase) * 0.35
      b.material.opacity = 0.26 + Math.sin(elapsed * 0.6 + b.userData.phase) * 0.08
    }
    this.dust.rotation.y = Math.sin(elapsed * 0.05) * 0.05
    this.dust.position.y = Math.sin(elapsed * 0.3) * 0.2

    this.composer.render()
  }

  dispose() {
    this.clearNotes()
    this.renderer.dispose()
    this.composer.dispose?.()
  }
}
