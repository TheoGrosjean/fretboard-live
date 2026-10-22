/**
 * Positions (« boxes ») d'une gamme ou d'un arpège sur le manche.
 *
 * Box k : on part du k-ième degré sur la corde grave, puis on remonte la gamme en mettant un nombre
 * fixe de notes par corde (2 pour les pentatoniques et arpèges, 3 pour les gammes à 6–8 notes).
 * On retrouve ainsi les 5 boxes classiques de la pentatonique et les positions « 3 notes par corde ».
 * Le blues reprend les boxes de la pentatonique mineure, avec la blue note en plus.
 * Chaque box est répétée à toutes les octaves qui tiennent sur le manche.
 */

const key = (p) => `${p.string}-${p.fret}`

function buildBox(intervals, startIndex, root, tuning, nps, baseFret) {
  const low = tuning.length - 1 // tuning va de la corde aiguë à la grave
  const positions = []
  let pitch = tuning[low] + baseFret
  let idx = startIndex
  for (let s = low; s >= 0; s--) {
    for (let n = 0; n < nps; n++) {
      positions.push({ string: s, fret: pitch - tuning[s] })
      const next = (idx + 1) % intervals.length
      pitch += (intervals[next] - intervals[idx] + 12) % 12
      idx = next
    }
  }
  return positions
}

/**
 * Boxes de la gamme `pattern` (voir SCALES / ARPEGGIOS) en tonalité `root` (0–11).
 * Renvoie [{ index, keys: Set('corde-case'), minFret, maxFret, center }] ; minFret / maxFret / center
 * décrivent la copie la plus basse sur le manche.
 */
export function scaleBoxes(root, pattern, tuning, frets) {
  if (!pattern) return []
  // 7 cordes : les boxes restent celles de la guitare 6 cordes (calées sur le Mi grave, comme on les apprend),
  // prolongées sur la corde grave par les notes de la gamme dans la même zone de cases
  if (tuning.length > 6) {
    const pcs = new Set(pattern.intervals.map((i) => (root + i) % 12))
    return scaleBoxes(root, pattern, tuning.slice(0, 6), frets).map((box) => {
      const keys = new Set(box.keys)
      for (const [lo, hi] of box.ranges)
        for (let string = 6; string < tuning.length; string++)
          for (let fret = lo; fret <= hi; fret++) if (pcs.has((((tuning[string] + fret) % 12) + 12) % 12)) keys.add(key({ string, fret }))
      return { ...box, keys, center: { ...box.center, string: (tuning.length - 1) / 2 } }
    })
  }
  const blues = pattern.intervals.includes(6) && pattern.id === 'blues'
  const intervals = [...pattern.intervals].filter((i) => !blues || i !== 6).sort((a, b) => a - b)
  const nps = intervals.length <= 5 ? 2 : 3
  const low = tuning.length - 1

  return intervals.map((startInterval, index) => {
    const startFret = (((root + startInterval - tuning[low]) % 12) + 12) % 12
    let base = buildBox(intervals, index, root, tuning, nps, startFret)
    if (base.some((p) => p.fret < 0)) base = base.map((p) => ({ ...p, fret: p.fret + 12 }))

    // Blue note : ajoutée sur chaque corde, dans l'étendue de la box
    if (blues) {
      const min = Math.min(...base.map((p) => p.fret))
      const max = Math.max(...base.map((p) => p.fret))
      tuning.forEach((open, string) => {
        for (let fret = min; fret <= max; fret++) {
          if ((((open + fret - root - 6) % 12) + 12) % 12 === 0) base.push({ string, fret })
        }
      })
    }

    // Toutes les octaves qui tiennent entièrement sur le manche
    const copies = [-12, 0, 12, 24]
      .map((shift) => base.map((p) => ({ ...p, fret: p.fret + shift })))
      .filter((copy) => copy.every((p) => p.fret >= 0 && p.fret <= frets))
    const lowest = copies[0] ?? base
    const lowFrets = lowest.map((p) => p.fret)
    const minFret = Math.min(...lowFrets)
    const maxFret = Math.max(...lowFrets)
    return {
      index,
      keys: new Set(copies.flat().map(key)),
      ranges: copies.map((c) => [Math.min(...c.map((p) => p.fret)), Math.max(...c.map((p) => p.fret))]),
      minFret,
      maxFret,
      center: { fret: (minFret + maxFret) / 2, string: (tuning.length - 1) / 2 },
    }
  })
}

export const positionKey = key
