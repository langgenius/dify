import { debounce, parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const snippetListQueryParsers = {
  tagIDs: parseAsArrayOf(parseAsString, ';')
    .withDefault([])
    .withOptions({ history: 'push' }),
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(SNIPPET_LIST_SEARCH_DEBOUNCE_MS),
  }),
  creatorID: parseAsString
    .withDefault('')
    .withOptions({ history: 'push' }),
}

export function useSnippetsQueryState() {
  const [query, setQuery] = useQueryStates(snippetListQueryParsers)

  const setKeywords = useCallback((keywords: string) => {
    setQuery({ keywords })
  }, [setQuery])

  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery({ tagIDs })
  }, [setQuery])

  const setCreatorID = useCallback((creatorID: string) => {
    setQuery({ creatorID })
  }, [setQuery])

  return useMemo(() => ({
    query,
    setKeywords,
    setTagIDs,
    setCreatorID,
  }), [query, setCreatorID, setKeywords, setTagIDs])
}
