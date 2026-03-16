import type { InitOptions } from 'modern-monaco'
import { basePath } from '@/utils/var'

export const LIGHT_THEME_ID = 'light-plus'
export const DARK_THEME_ID = 'dark-plus'

const TM_THEMES_VERSION = '1.12.1'
const TM_GRAMMARS_VERSION = '1.31.2'
const MODERN_MONACO_IMPORTMAP_ATTR = 'data-modern-monaco-importmap'
const HOIST_BASE_PATH = '/hoisted-modern-monaco'

const assetPath = (pathname: string) => `${basePath}${HOIST_BASE_PATH}${pathname}`
const themeAssetPath = (themeId: string) => assetPath(`/tm-themes@${TM_THEMES_VERSION}/themes/${themeId}.json`)
const grammarAssetPath = (languageId: string) => assetPath(`/tm-grammars@${TM_GRAMMARS_VERSION}/grammars/${languageId}.json`)
const monacoModuleAssetPath = (pathname: string) => new URL(assetPath(pathname), location.origin).toString()

const DEFAULT_INIT_OPTIONS: InitOptions = {
  defaultTheme: themeAssetPath(DARK_THEME_ID),
  themes: [
    themeAssetPath(LIGHT_THEME_ID),
    themeAssetPath(DARK_THEME_ID),
  ],
  langs: [
    grammarAssetPath('javascript'),
    grammarAssetPath('json'),
    grammarAssetPath('python'),
    grammarAssetPath('html'),
    grammarAssetPath('css'),
  ],
}

let monacoInitPromise: Promise<typeof import('modern-monaco/editor-core') | null> | null = null

function ensureMonacoImportMap() {
  const importMap = JSON.stringify({
    imports: {
      'modern-monaco/editor-core': monacoModuleAssetPath('/modern-monaco/editor-core.mjs'),
      'modern-monaco/lsp': monacoModuleAssetPath('/modern-monaco/lsp/index.mjs'),
    },
  })

  let script = document.querySelector<HTMLScriptElement>(`script[type="importmap"][${MODERN_MONACO_IMPORTMAP_ATTR}]`)
  if (!script) {
    script = document.createElement('script')
    script.type = 'importmap'
    script.setAttribute(MODERN_MONACO_IMPORTMAP_ATTR, '')
  }

  script.textContent = importMap
  document.head.prepend(script)
}

export const initMonaco = async () => {
  if (!monacoInitPromise) {
    monacoInitPromise = (async () => {
      ensureMonacoImportMap()
      const { init } = await import('modern-monaco')
      return init(DEFAULT_INIT_OPTIONS)
    })()
  }

  return monacoInitPromise
}
