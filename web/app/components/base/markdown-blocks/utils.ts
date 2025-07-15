import { ALLOW_UNSAFE_DATA_SCHEME } from '@/config'

export const isValidUrl = (url: string): boolean => {
  const validPrefixes = ['http:', 'https:', '//', 'mailto:']
  if (ALLOW_UNSAFE_DATA_SCHEME) validPrefixes.push('data:')
  return validPrefixes.some(prefix => url.startsWith(prefix))
}
