import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { inferParserType } from 'nuqs'
import { zGetAppsQuery } from '@dify/contracts/api/console/apps/zod.gen'
import { createParser, debounce, parseAsString } from 'nuqs'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'

type AppListMode = NonNullable<NonNullable<GetAppsData['query']>['mode']>

export const studioAppListCategories = [
  'all',
  'workflow',
  'advanced-chat',
  'chat',
  'agent-chat',
  'completion',
] as const satisfies readonly AppListMode[]

const studioAppListCategorySchema = zGetAppsQuery.shape.mode
  .unwrap()
  .unwrap()
  .extract(studioAppListCategories)

const parseAsAppListCategory = createParser({
  parse: (value) => {
    const result = studioAppListCategorySchema.safeParse(value)
    return result.success ? result.data : null
  },
  serialize: String,
})
  .withDefault('all')
  .withOptions({ history: 'push' })

export const appListQueryParsers = {
  category: parseAsAppListCategory,
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(APP_LIST_SEARCH_DEBOUNCE_MS),
  }),
}

export type AppListUrlQuery = inferParserType<typeof appListQueryParsers>
