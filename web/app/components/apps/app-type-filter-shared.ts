import { parseAsStringLiteral } from 'nuqs'
import { AppModes } from '@/types/app'

export const APP_LIST_CATEGORY_VALUES = ['all', ...AppModes] as const
export type AppListCategory = typeof APP_LIST_CATEGORY_VALUES[number]

const appListCategorySet = new Set<string>(APP_LIST_CATEGORY_VALUES)

export const isAppListCategory = (value: string): value is AppListCategory => {
  return appListCategorySet.has(value)
}

export const parseAsAppListCategory = parseAsStringLiteral(APP_LIST_CATEGORY_VALUES)
  .withDefault('all')
  .withOptions({ history: 'push' })
