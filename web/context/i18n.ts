import type { Locale } from '@/i18n-config/language'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from '#i18n'
import { useCallback } from 'react'
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

export const defaultDocBaseUrl = 'https://docs.bash-is-all-you-need.dify.dev'
export type DocPathMap = Partial<Record<Locale, DocPathWithoutLang>>
export type DocAnchorMap = Partial<Record<Locale, string>>

const splitPathWithHash = (path: string) => {
  const [pathname, ...hashParts] = path.split('#')
  return {
    pathname,
    hash: hashParts.join('#'),
  }
}

const normalizeAnchor = (anchor: string) => {
  const normalizedAnchor = anchor.startsWith('#') ? anchor.slice(1) : anchor
  if (!normalizedAnchor)
    return ''

  const isAsciiOnly = Array.from(normalizedAnchor).every(char => char.codePointAt(0)! <= 0x7F)
  if (isAsciiOnly)
    return normalizedAnchor

  return encodeURIComponent(normalizedAnchor)
}

export const useDocLink = (baseUrl?: string): ((path?: DocPathWithoutLang, pathMap?: DocPathMap, anchorMap?: DocAnchorMap) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = (baseDocUrl.endsWith('/')) ? baseDocUrl.slice(0, -1) : baseDocUrl
  const locale = useLocale()
  return useCallback(
    (path?: DocPathWithoutLang, pathMap?: DocPathMap, anchorMap?: DocAnchorMap): string => {
      const docLanguage = getDocLanguage(locale)
      const pathUrl = path || ''
      const targetPath = (pathMap) ? pathMap[locale] || pathUrl : pathUrl
      const { pathname: pathWithoutHash, hash: pathAnchor } = splitPathWithHash(targetPath)
      let targetPathWithoutHash = pathWithoutHash
      let languagePrefix = `/${docLanguage}`

      if (targetPathWithoutHash.startsWith('/api-reference/')) {
        languagePrefix = ''
        if (docLanguage !== 'en') {
          const translatedPath = apiReferencePathTranslations[targetPathWithoutHash]?.[docLanguage]
          if (translatedPath) {
            targetPathWithoutHash = translatedPath
          }
        }
      }

      const anchor = normalizeAnchor(anchorMap?.[locale] || pathAnchor)
      const anchorSuffix = anchor ? `#${anchor}` : ''

      return `${baseDocUrl}${languagePrefix}${targetPathWithoutHash}${anchorSuffix}`
    },
    [baseDocUrl, locale],
  )
}
