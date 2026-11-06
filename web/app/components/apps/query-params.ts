import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { inferParserType } from 'nuqs'
import type { AppType } from './app-type'
import { zGetAppsQuery } from '@dify/contracts/api/console/apps/zod.gen'
import {
  createParser,
  createSerializer,
  debounce,
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs'
import { APP_TYPES } from './app-type'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'

type AppListMode = NonNullable<NonNullable<GetAppsData['query']>['mode']>

export const studioAppListCategories = [
  'all',
  ...APP_TYPES,
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
  creatorIDs: parseAsArrayOf(parseAsString, ';').withDefault([]),
  tagIDs: parseAsArrayOf(parseAsString, ';').withDefault([]),
  sort_by: parseAsStringLiteral(zGetAppsQuery.shape.sort_by.unwrap().unwrap().options).withDefault(
    zGetAppsQuery.shape.sort_by.parse(undefined),
  ),
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(APP_LIST_SEARCH_DEBOUNCE_MS),
  }),
}

export const serializeAppListQuery = createSerializer(appListQueryParsers)

export const createAppPath = '/apps/create'
/** Opens the Studio with the template creation dialog. */
export const createAppTemplatePath = '/apps/create/template'
export const createAppModeQueryParser = parseAsStringLiteral(APP_TYPES)

/** Opens the Studio with the blank creation dialog, defaulting to `mode` when given. */
export const getCreateAppHref = (mode?: AppType) =>
  mode ? `${createAppPath}?mode=${mode}` : createAppPath

export type AppListUrlQuery = inferParserType<typeof appListQueryParsers>
