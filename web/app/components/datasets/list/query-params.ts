import { debounce, parseAsArrayOf, parseAsBoolean, parseAsString } from 'nuqs'

export const datasetListQueryParsers = {
  keyword: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(500),
  }),
  tag_ids: parseAsArrayOf(parseAsString, ';').withDefault([]),
  include_all: parseAsBoolean.withDefault(false),
}

