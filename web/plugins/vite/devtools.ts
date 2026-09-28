import type { Plugin } from 'vite'
import { injectClientSnippet, normalizeViteModuleId } from './utils.ts'

export const devtoolsClientPlugin = (injectTarget: string): Plugin => ({
  name: 'dify:devtools-client',
  apply: 'serve',
  transform(code, id) {
    if (this.environment.name !== 'client' || normalizeViteModuleId(id) !== injectTarget)
      return null

    // Vinext's App Router bypasses transformIndexHtml. Load the hub's prebuilt
    // client at runtime, as DevTools does, to keep it outside Vite's module graph.
    const marker = 'dify-devtools-client'
    const nextCode = injectClientSnippet(
      code,
      marker,
      `/* ${marker} */
if (!document.querySelector('script[src="/__devtools/embedded.js"]')) {
  const script = document.createElement('script')
  script.type = 'module'
  script.src = '/__devtools/embedded.js'
  document.head.appendChild(script)
}
`,
    )
    return nextCode === code ? null : { code: nextCode, map: null }
  },
})
