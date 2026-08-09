const loading = new Map()

/**
 * Add a <script> to the page once, however many times it is asked for.
 *
 * Everything heavy or third-party arrives this way — the editor, and later the
 * cloud providers — so that a reader who only opens a note never downloads it.
 */
export function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = src
      el.async = true
      el.onload = () => resolve()
      el.onerror = () => {
        loading.delete(src) // let a later attempt retry after a network failure
        reject(new Error(`Failed to load ${src}`))
      }
      document.head.append(el)
    }))
  }
  return loading.get(src)
}
