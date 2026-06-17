import type { Locale } from '@/i18n-config/language'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'
import { IS_CLOUD_EDITION } from '@/config'
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

export const getDocHomePath = () => IS_CLOUD_EDITION ? '/home' : '/self-host/deploy/overview'

export const useDocLink = (baseUrl?: string): ((path?: DocPathWithoutLang, pathMap?: DocPathMap) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = (baseDocUrl.endsWith('/')) ? baseDocUrl.slice(0, -1) : baseDocUrl
  const locale = useLocale()
  return useCallback(
    (path?: DocPathWithoutLang, pathMap?: DocPathMap): string => {
      const docLanguage = getDocLanguage(locale)
      const pathUrl = path || ''
      let targetPath = (pathMap) ? pathMap[locale] || pathUrl : pathUrl
      let languagePrefix = `/${docLanguage}`

      if (targetPath.startsWith('/api-reference/')) {
        languagePrefix = ''
        if (docLanguage !== 'en') {
          const translatedPath = apiReferencePathTranslations[targetPath]?.[docLanguage]
          if (translatedPath) {
            targetPath = translatedPath
          }
        }
      }
      else if (targetPath === '/use-dify' || targetPath.startsWith('/use-dify/')) {
        const productPrefix = IS_CLOUD_EDITION ? '/cloud' : '/self-host'
        targetPath = `${productPrefix}${targetPath}`
      }
      else if (!targetPath) {
        targetPath = getDocHomePath()
      }

      return `${baseDocUrl}${languagePrefix}${targetPath}`
    },
    [baseDocUrl, locale],
  )
}
