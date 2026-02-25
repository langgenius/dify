import { ALLOW_UNSAFE_DATA_SCHEME, MARKETPLACE_API_PREFIX } from '@/config'

type MdastNode = {
  tagName?: string
  children?: MdastNode[]
  [key: string]: unknown
}

/**
 * Recursively checks whether any child node is an <img> element.
 * Handles nested structures like linked images ([![alt](url)](link))
 * or formatted images (**![alt](url)**).
 */
export const hasImageChild = (children: MdastNode[] | undefined): boolean => {
  return children?.some((child) => {
    if (child.tagName === 'img')
      return true
    if (child.children)
      return hasImageChild(child.children)
    return false
  }) || false
}

export const isValidUrl = (url: string): boolean => {
  const validPrefixes = ['http:', 'https:', '//', 'mailto:']
  if (ALLOW_UNSAFE_DATA_SCHEME)
    validPrefixes.push('data:')
  return validPrefixes.some(prefix => url.startsWith(prefix))
}

export const getMarkdownImageURL = (url: string, pathname?: string) => {
  const regex = /(^\.\/_assets|^_assets)/
  if (regex.test(url))
    return `${MARKETPLACE_API_PREFIX}${MARKETPLACE_API_PREFIX.endsWith('/') ? '' : '/'}plugins/${pathname ?? ''}${url.replace(regex, '/_assets')}`
  return url
}
