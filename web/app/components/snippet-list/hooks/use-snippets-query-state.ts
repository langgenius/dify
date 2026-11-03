import type { SnippetPublishStatus } from '../query-params'
import { throttle, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { snippetListQueryParsers } from '../query-params'

export function useSnippetsQueryState() {
  const [query, setQuery] = useQueryStates(snippetListQueryParsers)

  const setKeywords = useCallback(
    (keywords: string) => {
      void setQuery({ keywords })
    },
    [setQuery],
  )

  const setTagIDs = useCallback(
    (tagIDs: string[]) => {
      void setQuery({ tagIDs })
    },
    [setQuery],
  )

  const setCreatorIDs = useCallback(
    (creatorIDs: string[]) => {
      void setQuery({ creatorIDs })
    },
    [setQuery],
  )

  const setPublishStatus = useCallback(
    (publishStatus: SnippetPublishStatus) => {
      void setQuery({ publishStatus })
    },
    [setQuery],
  )
  const flush = useCallback(
    () => setQuery(query, { history: 'replace', limitUrlUpdates: throttle(0) }),
    [query, setQuery],
  )

  return useMemo(
    () => ({
      query,
      setKeywords,
      setTagIDs,
      setCreatorIDs,
      setPublishStatus,
      flush,
    }),
    [flush, query, setCreatorIDs, setKeywords, setPublishStatus, setTagIDs],
  )
}
