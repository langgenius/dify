import { debounce, parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const snippetListQueryParsers = {
  tagIDs: parseAsArrayOf(parseAsString, ';')
    .withDefault([])
    .withOptions({ history: 'push' }),
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(SNIPPET_LIST_SEARCH_DEBOUNCE_MS),
  }),
}

export function useSnippetsQueryState() {
  const [urlQuery, setUrlQuery] = useQueryStates(snippetListQueryParsers)
  const [creatorID, setCreatorID] = useState('')

  const setKeywords = useCallback((keywords: string) => {
    setUrlQuery({ keywords })
  }, [setUrlQuery])

  const setTagIDs = useCallback((tagIDs: string[]) => {
    setUrlQuery({ tagIDs })
  }, [setUrlQuery])

  const handleSetCreatorID = useCallback((creatorID: string) => {
    setCreatorID(creatorID)
  }, [])

  const query = useMemo(() => ({
    ...urlQuery,
    creatorID,
  }), [creatorID, urlQuery])

  return useMemo(() => ({
    query,
    setKeywords,
    setTagIDs,
    setCreatorID: handleSetCreatorID,
  }), [handleSetCreatorID, query, setKeywords, setTagIDs])
}
