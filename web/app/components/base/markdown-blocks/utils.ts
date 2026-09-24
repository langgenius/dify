import type { ExtraProps } from 'streamdown'
import { ALLOW_UNSAFE_DATA_SCHEME, MARKETPLACE_API_PREFIX } from '@/config'

export const hasImageChild = (
  children: NonNullable<ExtraProps['node']>['children'] | undefined,
): boolean => {
  return (
    children?.some(
      (child) =>
        child.type === 'element' && (child.tagName === 'img' || hasImageChild(child.children)),
    ) ?? false
  )
}

export const isValidUrl = (url: string): boolean => {
  const validPrefixes = ['http:', 'https:', '//', 'mailto:']
  if (ALLOW_UNSAFE_DATA_SCHEME) validPrefixes.push('data:')
  return validPrefixes.some((prefix) => url.startsWith(prefix))
}

export const getMarkdownImageURL = (url: string, pathname?: string) => {
  const regex = /(^\.\/_assets|^_assets)/
  if (regex.test(url))
    return `${MARKETPLACE_API_PREFIX}${MARKETPLACE_API_PREFIX.endsWith('/') ? '' : '/'}plugins/${pathname ?? ''}${url.replace(regex, '/_assets')}`
  return url
}
