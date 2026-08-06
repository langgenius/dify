import { parseAsStringLiteral } from 'nuqs'
import { AppModes } from '@/types/app'

const APP_LIST_CATEGORY_VALUES = ['all', ...AppModes] as const
export type AppListCategory = (typeof APP_LIST_CATEGORY_VALUES)[number]

export const parseAsAppListCategory = parseAsStringLiteral(APP_LIST_CATEGORY_VALUES)
  .withDefault('all')
  .withOptions({ history: 'push' })
