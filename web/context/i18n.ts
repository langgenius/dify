import type { Locale } from '@/i18n-config/language'
import { atom, useAtomValue } from 'jotai'
import { getDocLanguage, getLanguage, getPricingPageLanguage } from '@/i18n-config/language'

export const localeAtom = atom<Locale>('en-US')
export const useLocale = () => {
  return useAtomValue(localeAtom)
}

export const useGetLanguage = () => {
  const locale = useLocale()

  return getLanguage(locale)
}
export const useGetPricingPageLanguage = () => {
  const locale = useLocale()

  return getPricingPageLanguage(locale)
}

export const defaultDocBaseUrl = 'https://docs.dify.ai'
export const useDocLink = (baseUrl?: string): ((path?: string, pathMap?: { [index: string]: string }) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = (baseDocUrl.endsWith('/')) ? baseDocUrl.slice(0, -1) : baseDocUrl
  const locale = useLocale()
  const docLanguage = getDocLanguage(locale)
  return (path?: string, pathMap?: { [index: string]: string }): string => {
    const pathUrl = path || ''
    let targetPath = (pathMap) ? pathMap[locale] || pathUrl : pathUrl
    targetPath = (targetPath.startsWith('/')) ? targetPath.slice(1) : targetPath
    return `${baseDocUrl}/${docLanguage}/${targetPath}`
  }
}
