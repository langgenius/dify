import type { InitOptions } from 'modern-monaco'
import { basePath } from '@/utils/var'
import {
  HOIST_BASE_PATH,
  HOIST_LANGUAGE_IDS,
  HOIST_THEME_IDS,
  MODERN_MONACO_IMPORT_MAP,
  TM_GRAMMARS_VERSION,
  TM_THEMES_VERSION,
} from './hoisted-config'

export const LIGHT_THEME_ID = 'light-plus'
export const DARK_THEME_ID = 'dark-plus'

const MODERN_MONACO_IMPORTMAP_ATTR = 'data-modern-monaco-importmap'

const assetPath = (pathname: string) => `${basePath}${HOIST_BASE_PATH}${pathname}`
const themeAssetPath = (themeId: string) => assetPath(`/tm-themes@${TM_THEMES_VERSION}/themes/${themeId}.json`)
const grammarAssetPath = (languageId: string) => assetPath(`/tm-grammars@${TM_GRAMMARS_VERSION}/grammars/${languageId}.json`)
const monacoModuleAssetPath = (pathname: string) => new URL(assetPath(pathname), location.origin).toString()

const DEFAULT_INIT_OPTIONS: InitOptions = {
  defaultTheme: themeAssetPath(DARK_THEME_ID),
  themes: HOIST_THEME_IDS.map(themeAssetPath),
  langs: HOIST_LANGUAGE_IDS.map(grammarAssetPath),
}

let monacoInitPromise: Promise<typeof import('modern-monaco/editor-core') | null> | null = null

function ensureMonacoImportMap() {
  const importMap = JSON.stringify({
    imports: Object.fromEntries(
      Object.entries(MODERN_MONACO_IMPORT_MAP).map(([specifier, pathname]) => [specifier, monacoModuleAssetPath(pathname)]),
    ),
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
