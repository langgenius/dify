import type { PluginConfig } from 'streamdown'
import { useEffect, useState } from 'react'

// This is an overinclusive loading hint, not a formula parser. Dollars cover
// inline/display math; HTML and fences can produce math-classed code elements.
// Let the original parser handle escaping, code and single-dollar configuration.
const POSSIBLE_MATH = /[$<]|`{3}|~{3}/
let pendingPlugins: Promise<PluginConfig> | undefined

function loadMathPlugins() {
  pendingPlugins ??= import('./math-plugins')
    .then((module) => module.mathPlugins)
    .catch((error) => {
      pendingPlugins = undefined
      throw error
    })
  return pendingPlugins
}

export function useMathPlugins(content: string, hasCustomPlugins: boolean) {
  // Start consistently on the server and during hydration, even if another
  // Markdown instance has already loaded the shared module.
  const [plugins, setPlugins] = useState<PluginConfig>()
  const needsMath = hasCustomPlugins || POSSIBLE_MATH.test(content)

  useEffect(() => {
    if (!needsMath) return

    let cancelled = false
    void loadMathPlugins().then(
      (loaded) => {
        if (!cancelled) setPlugins(loaded)
      },
      (error) => {
        // Keep the source readable when a chunk fails to load. A later mount
        // can retry instead of sharing a permanently rejected promise.
        console.error('Markdown math loading failed:', error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [needsMath])

  return plugins
}
