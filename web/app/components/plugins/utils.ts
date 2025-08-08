import { LanguagesSupported } from '@/i18n-config/language'

import {
  categoryKeys,
  tagKeys,
} from './constants'

export const getValidTagKeys = (tags: string[]) => {
  return tags.filter(tag => tagKeys.includes(tag))
}

export const getValidCategoryKeys = (category?: string) => {
  return categoryKeys.find(key => key === category)
}

export const getDocsUrl = (locale: string, path: string) => {
  let localePath = 'en'

  if (locale === LanguagesSupported[1])
    localePath = 'zh-hans'

  else if (locale === LanguagesSupported[7])
    localePath = 'ja-jp'

  return `https://docs.dify.ai/${localePath}${path}`
}
