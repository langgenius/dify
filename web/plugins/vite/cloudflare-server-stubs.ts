import type { Plugin } from 'vite-plus'
import path from 'node:path'

// Browser-only modules that are pulled into the Worker's server bundles even though SSR never
// runs them: they are reached only through dynamic import(), React.lazy, or a modal that is
// closed on first render. Their chunks still count toward the Worker's 64 MiB upload limit
// (loro-crdt alone ships a 3.4 MiB WASM file), so the Cloudflare build swaps them for tiny
// stubs in the server environments. The client environment is untouched.
//
// A stub keeps the module's export names, so a missing or renamed export fails the build.
// If SSR ever does call into one, it throws an error that names the module.
const BROWSER_ONLY = `
const browserOnly = (name) => new Proxy(function () {}, {
  get(_target, key) {
    if (key === 'then') return undefined
    throw new Error(\`[cloudflare] \${name} is browser-only and stubbed out of the Worker bundle\`)
  },
  apply() {
    throw new Error(\`[cloudflare] \${name} is browser-only and stubbed out of the Worker bundle\`)
  },
  construct() {
    throw new Error(\`[cloudflare] \${name} is browser-only and stubbed out of the Worker bundle\`)
  },
})
`

const RENDER_NOTHING = 'const renderNothing = () => null\n'

const PROJECT_STUBS: Record<string, string> = {
  // Collaborative editing: loro-crdt (3.4 MiB WASM), loaded with import() after the editor mounts.
  'app/components/workflow/collaboration/core/crdt-runtime.ts': `${BROWSER_ONLY}export const crdtRuntime = browserOnly('crdtRuntime')\n`,
  // Analytics and session replay, loaded with import() from an effect.
  'app/components/base/amplitude/runtime.ts': `${BROWSER_ONLY}export const initializeAmplitudeSDK = browserOnly('initializeAmplitudeSDK')\n`,
  // Voice input MP3 encoding (mediabunny), loaded with import() when recording starts.
  'app/components/base/voice-input/mp3-encoder.ts': `${BROWSER_ONLY}export const createMp3Encoder = browserOnly('createMp3Encoder')\n`,
  // ABC music notation in Markdown (abcjs), React.lazy; it draws into the DOM from an effect.
  'app/components/base/markdown-blocks/music.tsx': `${RENDER_NOTHING}export default renderNothing\n`,
  // PDF preview (react-pdf-highlighter + pdfjs-dist), only rendered inside an opened preview.
  'app/components/base/file-uploader/pdf-highlighter-adapter.tsx': `${RENDER_NOTHING}export const PdfHighlighter = renderNothing\nexport const PdfLoader = renderNothing\n`,
}

const PACKAGE_STUBS: Record<string, string> = {
  // Workflow auto layout, loaded with import() from a user action.
  'elkjs/lib/elk.bundled.js': `${BROWSER_ONLY}export default browserOnly('elkjs')\n`,
  // Mermaid diagrams in Markdown; use-diagram.ts only calls pele inside layout effects.
  pele: `${BROWSER_ONLY}export const enableZoom = browserOnly('pele.enableZoom')\nexport const forgetTextWidths = browserOnly('pele.forgetTextWidths')\nexport const parse = browserOnly('pele.parse')\nexport const render = browserOnly('pele.render')\n`,
}

export function cloudflareServerStubs({ projectRoot }: { projectRoot: string }): Plugin {
  const projectStubs = new Map(
    Object.entries(PROJECT_STUBS).map(([file, code]) => [path.join(projectRoot, file), code]),
  )
  const stubId = (specifier: string) => `\0cloudflare-server-stub:${specifier}`

  return {
    name: 'dify:cloudflare-server-stubs',
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.name !== 'client',
    resolveId(source) {
      if (source in PACKAGE_STUBS) return stubId(source)
      return undefined
    },
    load(id) {
      if (id.startsWith(stubId(''))) return PACKAGE_STUBS[id.slice(stubId('').length)]
      const code = projectStubs.get(id.split('?')[0]!)
      return code === undefined ? undefined : { code, moduleType: 'js' }
    },
  }
}
