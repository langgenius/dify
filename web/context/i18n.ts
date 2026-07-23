import type { Locale } from '@/i18n-config/language'
import type { DocPathWithoutLang, DocsProduct } from '@/types/doc-paths'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'
import { deploymentEditionAtom } from '@/context/system-features-state'
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

const getCurrentDocsProduct = (deploymentEdition: DeploymentEdition | null): DocsProduct | null => {
  if (deploymentEdition === 'CLOUD') return 'cloud'
  if (deploymentEdition === 'COMMUNITY' || deploymentEdition === 'ENTERPRISE') return 'self-host'
  return null
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

const getProductAwarePath = (
  path: string,
  deploymentEdition: DeploymentEdition | null,
): string => {
  const { pathname, hash } = splitPathHash(path)
  const availableProducts = docPathProductAvailability[pathname]
  if (!availableProducts?.length) return path

  const currentProduct = getCurrentDocsProduct(deploymentEdition)
  if (!currentProduct) return path
  const targetProduct = availableProducts.includes(currentProduct)
    ? currentProduct
    : availableProducts[0]

  if (!targetProduct) return path

  return `/${targetProduct}${pathname}${hash}`
}

export const useDocLink = (
  baseUrl?: string,
): ((path?: DocPathWithoutLang, pathMap?: DocPathMap) => string) => {
  let baseDocUrl = baseUrl || defaultDocBaseUrl
  baseDocUrl = baseDocUrl.endsWith('/') ? baseDocUrl.slice(0, -1) : baseDocUrl
  const locale = useLocale()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  return useCallback(
    (path?: DocPathWithoutLang, pathMap?: DocPathMap): string => {
      const docLanguage = getDocLanguage(locale)
      const pathUrl = path || ''
      let targetPath = pathMap ? pathMap[locale] || pathUrl : pathUrl
      const languagePrefix = `/${docLanguage}`

      if (!targetPath) {
        targetPath = getDocHomePath()
      } else {
        targetPath = getProductAwarePath(targetPath, deploymentEdition)
      }

      return `${baseDocUrl}${languagePrefix}${targetPath}`
    },
    [baseDocUrl, deploymentEdition, locale],
  )
}
