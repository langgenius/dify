import type { Locale } from '@/i18n-config/language'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from '#i18n'
import { getDocLanguage, getLanguage, getPricingPageLanguage } from '@/i18n-config/language'
import { apiReferencePathTranslations } from '@/types/doc-paths'

export const useLocale = () => {
  const { i18n } = useTranslation()
  return i18n.language as Locale
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
export type DocPathMap = Partial<Record<Locale, DocPathWithoutLang>>

export const useDocLink = (baseUrl?: string): ((path?: DocPathWithoutLang, pathMap?: DocPathMap) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = (baseDocUrl.endsWith('/')) ? baseDocUrl.slice(0, -1) : baseDocUrl
  const locale = useLocale()
  const docLanguage = getDocLanguage(locale)
  return (path?: DocPathWithoutLang, pathMap?: DocPathMap): string => {
    const pathUrl = path || ''
    let targetPath = (pathMap) ? pathMap[locale] || pathUrl : pathUrl
    let languagePrefix = `/${docLanguage}`

    // Translate API reference paths for non-English locales
    if (targetPath.startsWith('/api-reference/') && docLanguage !== 'en') {
      const translatedPath = apiReferencePathTranslations[targetPath]?.[docLanguage as 'zh' | 'ja']
      if (translatedPath) {
        targetPath = translatedPath
        languagePrefix = ''
      }
    }

    return `${baseDocUrl}${languagePrefix}${targetPath}`
  }
}
