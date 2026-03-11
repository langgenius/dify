import type { InitOptions } from 'modern-monaco'

export const LIGHT_THEME_ID = 'github-light-default'
export const DARK_THEME_ID = 'github-dark-default'

const DEFAULT_INIT_OPTIONS: InitOptions = {
  defaultTheme: DARK_THEME_ID,
  themes: [
    LIGHT_THEME_ID,
    DARK_THEME_ID,
  ],
}

let monacoInitPromise: Promise<typeof import('modern-monaco/editor-core') | null> | null = null
let monacoInitOptions = DEFAULT_INIT_OPTIONS

export const configureModernMonaco = (initOptions: InitOptions) => {
  if (monacoInitPromise)
    throw new Error('configureModernMonaco must be called before the first Monaco editor mounts.')

  monacoInitOptions = initOptions
}

export const initMonaco = async () => {
  if (!monacoInitPromise) {
    monacoInitPromise = (async () => {
      const { init } = await import('modern-monaco')
      return init(monacoInitOptions)
    })()
  }

  return monacoInitPromise
}
