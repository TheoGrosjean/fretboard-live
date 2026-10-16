import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Nombre qui défile de 0 à `target` (ralentit à la fin), après `delay` ms.
 * freezeAt (ms) : valeur figée à cet instant, pour les aperçus.
 */
export function useCountUp(target, { delay = 0, duration = 1200, freezeAt = null } = {}) {
  const at = (t) => {
    const p = Math.min(1, Math.max(0, (t - delay) / duration))
    return Math.round(target * (1 - (1 - p) ** 3))
  }
  const value = ref(freezeAt === null ? 0 : at(freezeAt))
  if (freezeAt !== null) return value

  let raf = 0
  let start = 0
  const tick = (now) => {
    value.value = at(now - start)
    if (now - start < delay + duration) raf = requestAnimationFrame(tick)
  }
  onMounted(() => {
    start = performance.now()
    raf = requestAnimationFrame(tick)
  })
  onBeforeUnmount(() => cancelAnimationFrame(raf))
  return value
}

export const formatScore = (n) => n.toLocaleString('fr-FR')
