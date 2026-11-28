export const AppCategories = {
  RECOMMENDED: 'Recommended',
} as const

export type AppCategories = (typeof AppCategories)[keyof typeof AppCategories]
