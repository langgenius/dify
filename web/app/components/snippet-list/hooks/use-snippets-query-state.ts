import { debounce, parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const snippetListQueryParsers = {
  tagIDs: parseAsArrayOf(parseAsString, ';').withDefault([]).withOptions({ history: 'push' }),
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(SNIPPET_LIST_SEARCH_DEBOUNCE_MS),
  }),
}

export function useSnippetsQueryState() {
  const [urlQuery, setUrlQuery] = useQueryStates(snippetListQueryParsers)
  const [creatorIDs, setCreatorIDs] = useState<string[]>([])

  const setKeywords = useCallback(
    (keywords: string) => {
      setUrlQuery({ keywords })
    },
    [setUrlQuery],
  )

  const setTagIDs = useCallback(
    (tagIDs: string[]) => {
      setUrlQuery({ tagIDs })
    },
    [setUrlQuery],
  )

  const handleSetCreatorIDs = useCallback((creatorIDs: string[]) => {
    setCreatorIDs(creatorIDs)
  }, [])

  const query = useMemo(
    () => ({
      ...urlQuery,
      creatorIDs,
    }),
    [creatorIDs, urlQuery],
  )

  return useMemo(
    () => ({
      query,
      setKeywords,
      setTagIDs,
      setCreatorIDs: handleSetCreatorIDs,
    }),
    [handleSetCreatorIDs, query, setKeywords, setTagIDs],
  )
}
