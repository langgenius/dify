import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { Locale } from '@/i18n-config/language'
import type { DocLanguage, DocPathWithoutLang, DocsProduct } from '@/types/doc-paths'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'
import { deploymentEditionAtom } from '@/features/system-features/state'
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
export const enterpriseDocBaseUrl = 'https://enterprise-docs.dify.ai'
export type DocPathMap = Partial<Record<Locale, DocPathWithoutLang>>

const getDocHomePath = () => '/home'

const getCurrentDocsProduct = (deploymentEdition: DeploymentEdition): DocsProduct => {
  if (deploymentEdition === 'CLOUD') return 'cloud'
  return 'self-host'
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

const getProductAwarePath = (path: string, deploymentEdition: DeploymentEdition): string => {
  const { pathname, hash } = splitPathHash(path)
  const availableProducts = docPathProductAvailability[pathname]
  if (!availableProducts?.length) return path

  const currentProduct = getCurrentDocsProduct(deploymentEdition)
  const targetProduct = availableProducts.includes(currentProduct)
    ? currentProduct
    : availableProducts[0]

  if (!targetProduct) return path

  return `/${targetProduct}${pathname}${hash}`
}

const replacePathPrefix = (path: string, sourcePrefix: string, targetPrefix: string): string => {
  if (path === sourcePrefix) return targetPrefix
  if (!path.startsWith(`${sourcePrefix}/`)) return path

  return `${targetPrefix}${path.slice(sourcePrefix.length)}`
}

const getEnterpriseDocLanguage = (docLanguage: DocLanguage): 'en' | 'zh' => {
  return docLanguage === 'zh' ? 'zh' : 'en'
}

const getEnterpriseDocPath = (path: string): string => {
  const { pathname, hash } = splitPathHash(path)
  let targetPath = pathname.replace(/^\/(?:cloud|self-host)(?=\/)/, '')

  if (targetPath === '/use-dify/getting-started/introduction')
    return `/use/build/workflow-chatflow${hash}`

  targetPath = replacePathPrefix(targetPath, '/use-dify', '/use')
  targetPath = replacePathPrefix(targetPath, '/api-reference', '/develop/api')
  targetPath = replacePathPrefix(targetPath, '/develop-plugin', '/develop/plugins')
  targetPath = replacePathPrefix(targetPath, '/cli', '/develop/cli')

  return `${targetPath}${hash}`
}

export const getEnterpriseDocUrl = (path: string, docLanguage: DocLanguage): string => {
  const language = getEnterpriseDocLanguage(docLanguage)
  const targetPath = path ? getEnterpriseDocPath(path) : '/'

  return `${enterpriseDocBaseUrl}/${language}${targetPath}`
}

export const useDocLink = (
  baseUrl?: string,
): ((path?: DocPathWithoutLang, pathMap?: DocPathMap) => string) => {
  const locale = useLocale()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const useEnterpriseDocs = deploymentEdition === 'ENTERPRISE' && !baseUrl
  let baseDocUrl = baseUrl || (useEnterpriseDocs ? enterpriseDocBaseUrl : defaultDocBaseUrl)
  baseDocUrl = baseDocUrl.endsWith('/') ? baseDocUrl.slice(0, -1) : baseDocUrl
  return useCallback(
    (path?: DocPathWithoutLang, pathMap?: DocPathMap): string => {
      const docLanguage = getDocLanguage(locale)
      const pathUrl = path || ''
      let targetPath = pathMap ? pathMap[locale] || pathUrl : pathUrl

      if (useEnterpriseDocs) return getEnterpriseDocUrl(targetPath, docLanguage)

      const languagePrefix = `/${docLanguage}`

      if (!targetPath) {
        targetPath = getDocHomePath()
      } else {
        targetPath = getProductAwarePath(targetPath, deploymentEdition)
      }

      return `${baseDocUrl}${languagePrefix}${targetPath}`
    },
    [baseDocUrl, deploymentEdition, locale, useEnterpriseDocs],
  )
}
