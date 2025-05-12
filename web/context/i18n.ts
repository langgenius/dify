import {
  createContext,
  useContext,
} from 'use-context-selector'
import type { Locale } from '@/i18n'
import { getDocLanguage, getLanguage, getPricingPageLanguage } from '@/i18n/language'
import { noop } from 'lodash-es'

type II18NContext = {
  locale: Locale
  i18n: Record<string, any>
  setLocaleOnClient: (_lang: Locale, _reloadPage?: boolean) => void
}

const I18NContext = createContext<II18NContext>({
  locale: 'en-US',
  i18n: {},
  setLocaleOnClient: noop,
})

export const useI18N = () => useContext(I18NContext)
export const useGetLanguage = () => {
  const { locale } = useI18N()

  return getLanguage(locale)
}
export const useGetDocLanguage = () => {
  const { locale } = useI18N()

  return getDocLanguage(locale)
}
export const useGetPricingPageLanguage = () => {
  const { locale } = useI18N()

  return getPricingPageLanguage(locale)
}

export default I18NContext
