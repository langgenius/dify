import {
  createContext,
  useContext,
} from 'use-context-selector'
import type { Locale } from '@/i18n'
import { getLanguage } from '@/i18n/language'

type II18NContext = {
  locale: Locale
  i18n: Record<string, any>
  setLocaleOnClient: (locale: Locale, reloadPage?: boolean) => void
}

const I18NContext = createContext<II18NContext>({
  locale: 'en-US',
  i18n: {},
  setLocaleOnClient: (lang: Locale, reloadPage?: boolean) => { },
})

export const useI18N = () => useContext(I18NContext)
export const useGetLanguage = () => {
  const { locale } = useI18N()

  return getLanguage(locale)
}

export default I18NContext
