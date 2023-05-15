import { createContext } from 'use-context-selector'
import type { Locale } from '@/i18n'

type II18NContext = {
  locale: Locale
  i18n: Record<string, any>,
  setLocaleOnClient: (locale: Locale) => void
  //   setI8N: (i18n: Record<string, string>) => void,
}

const I18NContext = createContext<II18NContext>({
  locale: 'en',
  i18n: {},
  setLocaleOnClient: (lang: Locale) => { }
  //   setI8N: () => {},
})

export default I18NContext
