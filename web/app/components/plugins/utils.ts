import {
  categoryKeys,
  tagKeys,
} from './constants'

export const getValidTagKeys = (tags: string[]) => {
  return tags.filter(tag => tagKeys.includes(tag))
}

export const getValidCategoryKeys = (category?: string) => {
  const currentCategory = categoryKeys.find(key => key === category)
  return currentCategory ? `${currentCategory}s` : ''
}
