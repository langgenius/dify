import { parseAsString } from 'nuqs'

export const envFilterQueryState = parseAsString.withOptions({ history: 'push' })
export const keywordsQueryState = parseAsString.withDefault('').withOptions({ history: 'push' })
