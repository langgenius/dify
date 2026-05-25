import { parseAsString } from 'nuqs'

export const ALL_ENVIRONMENTS_FILTER_VALUE = 'all'
const LEGACY_NOT_DEPLOYED_FILTER_VALUE = 'not-deployed'

export const envFilterQueryState = parseAsString.withDefault(ALL_ENVIRONMENTS_FILTER_VALUE).withOptions({ history: 'push' })
export const keywordsQueryState = parseAsString.withDefault('').withOptions({ history: 'push' })

export function environmentIdFromFilterValue(filterValue: string) {
  if (!filterValue || filterValue === ALL_ENVIRONMENTS_FILTER_VALUE || filterValue === LEGACY_NOT_DEPLOYED_FILTER_VALUE)
    return undefined

  return filterValue
}
