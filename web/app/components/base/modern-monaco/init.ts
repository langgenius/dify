import type { InitOptions } from 'modern-monaco'
import { basePath } from '@/utils/var'
import {
  HOIST_BASE_PATH,
  HOIST_LANGUAGE_IDS,
  HOIST_THEME_IDS,
  TM_GRAMMARS_VERSION,
  TM_THEMES_VERSION,
} from './hoisted-config'

export const LIGHT_THEME_ID = 'light-plus'
export const DARK_THEME_ID = 'dark-plus'

const assetPath = (pathname: string) => `${basePath}${HOIST_BASE_PATH}${pathname}`
const themeAssetPath = (themeId: string) => assetPath(`/tm-themes@${TM_THEMES_VERSION}/themes/${themeId}.json`)
const grammarAssetPath = (languageId: string) => assetPath(`/tm-grammars@${TM_GRAMMARS_VERSION}/grammars/${languageId}.json`)

const DEFAULT_INIT_OPTIONS: InitOptions = {
  defaultTheme: themeAssetPath(DARK_THEME_ID),
  themes: HOIST_THEME_IDS.map(themeAssetPath),
  langs: HOIST_LANGUAGE_IDS.map(grammarAssetPath),
}

let monacoInitPromise: Promise<typeof import('modern-monaco/editor-core') | null> | null = null

export const initMonaco = async () => {
  if (!monacoInitPromise) {
    monacoInitPromise = (async () => {
      const { init } = await import('modern-monaco')
      return init(DEFAULT_INIT_OPTIONS)
    })()
  }

  return monacoInitPromise
}
