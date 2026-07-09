import type { Locale } from '@/i18n-config/language'
import type { DocPathWithoutLang, DocsProduct } from '@/types/doc-paths'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'
import { IS_CLOUD_EDITION } from '@/config'
import { getDocLanguage, getLanguage, getPricingPageLanguage } from '@/i18n-config/language'
import { docPathProductAvailability } from '@/types/doc-paths'

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

export const getDocHomePath = () => '/home'

const getCurrentDocsProduct = (): DocsProduct => {
  return IS_CLOUD_EDITION ? 'cloud' : 'self-host'
}

const splitPathHash = (path: string) => {
  const hashIndex = path.indexOf('#')
  if (hashIndex === -1) {
    return {
      pathname: path,
      hash: '',
    }
  }

  return {
    pathname: path.slice(0, hashIndex),
    hash: path.slice(hashIndex),
  }
}

const getProductAwarePath = (path: string): string => {
  const { pathname, hash } = splitPathHash(path)
  const availableProducts = docPathProductAvailability[pathname]
  if (!availableProducts?.length)
    return path

  const currentProduct = getCurrentDocsProduct()
  const targetProduct = availableProducts.includes(currentProduct)
    ? currentProduct
    : availableProducts[0]

  if (!targetProduct)
    return path

  return `/${targetProduct}${pathname}${hash}`
}

export const useDocLink = (baseUrl?: string): ((path?: DocPathWithoutLang, pathMap?: DocPathMap) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = (baseDocUrl.endsWith('/')) ? baseDocUrl.slice(0, -1) : baseDocUrl
  const locale = useLocale()
  return useCallback(
    (path?: DocPathWithoutLang, pathMap?: DocPathMap): string => {
      const docLanguage = getDocLanguage(locale)
      const pathUrl = path || ''
      let targetPath = (pathMap) ? pathMap[locale] || pathUrl : pathUrl
      const languagePrefix = `/${docLanguage}`

      if (!targetPath) {
        targetPath = getDocHomePath()
      }
      else if (!targetPath.startsWith('/api-reference/')) {
        targetPath = getProductAwarePath(targetPath)
      }

      return `${baseDocUrl}${languagePrefix}${targetPath}`
    },
    [baseDocUrl, locale],
  )
}
