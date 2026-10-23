import { onBeforeUnmount, onMounted, ref } from 'vue'

/** Largeur d'un élément, suivie en continu (les graphiques gardent un texte de taille fixe). */
export function useWidth(el, initial = 600) {
  const width = ref(initial)
  let observer = null
  onMounted(() => {
    observer = new ResizeObserver(([entry]) => (width.value = Math.max(200, entry.contentRect.width)))
    if (el.value) observer.observe(el.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
  return width
}
