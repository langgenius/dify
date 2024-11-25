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
