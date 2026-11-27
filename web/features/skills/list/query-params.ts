import { debounce, parseAsArrayOf, parseAsString } from 'nuqs'

export const skillQueryParamNames = {
  keyword: 'keyword',
  tag: 'tag',
} as const

export const skillKeywordQueryParser = parseAsString.withDefault('').withOptions({
  limitUrlUpdates: debounce(300),
})

export const skillTagQueryParser = parseAsArrayOf(parseAsString, ';').withDefault([])
