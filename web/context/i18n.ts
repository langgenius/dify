import {
  createContext,
  useContext,
} from 'use-context-selector'
import type { Locale } from '@/i18n-config'
import { getDocLanguage, getLanguage, getPricingPageLanguage } from '@/i18n-config/language'
import { noop } from 'lodash-es'

type II18NContext = {
  locale: Locale
  i18n: Record<string, any>
  setLocaleOnClient: (_lang: Locale, _reloadPage?: boolean) => Promise<void>
}

const I18NContext = createContext<II18NContext>({
  locale: 'en-US',
  i18n: {},
  setLocaleOnClient: async (_lang: Locale, _reloadPage?: boolean) => {
    noop()
  },
})

export const useI18N = () => useContext(I18NContext)
export const useGetLanguage = () => {
  const { locale } = useI18N()

  return getLanguage(locale)
}
export const useGetPricingPageLanguage = () => {
  const { locale } = useI18N()

  return getPricingPageLanguage(locale)
}

export const defaultDocBaseUrl = 'https://docs.dify.ai'
export const useDocLink = (baseUrl?: string): ((path?: string, pathMap?: { [index: string]: string }) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = (baseDocUrl.endsWith('/')) ? baseDocUrl.slice(0, -1) : baseDocUrl
  const { locale } = useI18N()
  const docLanguage = getDocLanguage(locale)
  return (path?: string, pathMap?: { [index: string]: string }): string => {
    const pathUrl = path || ''
    let targetPath = (pathMap) ? pathMap[locale] || pathUrl : pathUrl
    targetPath = (targetPath.startsWith('/')) ? targetPath.slice(1) : targetPath
    return `${baseDocUrl}/${docLanguage}/${targetPath}`
  }
}
export default I18NContext
