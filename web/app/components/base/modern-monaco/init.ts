import type { InitOptions } from 'modern-monaco'

export const LIGHT_THEME_ID = 'light-plus'
export const DARK_THEME_ID = 'dark-plus'

const DEFAULT_INIT_OPTIONS: InitOptions = {
  defaultTheme: DARK_THEME_ID,
  themes: [
    LIGHT_THEME_ID,
    DARK_THEME_ID,
  ],
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
