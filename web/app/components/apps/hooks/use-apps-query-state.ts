import { parseAsArrayOf, parseAsBoolean, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'

export type AppSortField = 'created_at' | 'updated_at' | 'name'

export type AppSortBy = `${AppSortField}` | `-${AppSortField}`

type AppsQuery = {
  tagIDs?: string[]
  keywords?: string
  isCreatedByMe?: boolean
  sortBy?: AppSortBy
}

const normalizeKeywords = (value: string | null) => value || undefined

function useAppsQueryState() {
  const [urlQuery, setUrlQuery] = useQueryStates(
    {
      tagIDs: parseAsArrayOf(parseAsString, ';'),
      keywords: parseAsString,
      isCreatedByMe: parseAsBoolean,
      sortBy: parseAsString,
    },
    {
      history: 'push',
    },
  )

  const query = useMemo<AppsQuery>(() => ({
    tagIDs: urlQuery.tagIDs ?? undefined,
    keywords: normalizeKeywords(urlQuery.keywords),
    isCreatedByMe: urlQuery.isCreatedByMe ?? false,
    sortBy: (urlQuery.sortBy as AppSortBy) || '-created_at',
  }), [urlQuery.isCreatedByMe, urlQuery.keywords, urlQuery.tagIDs, urlQuery.sortBy])

  const setQuery = useCallback((next: AppsQuery | ((prev: AppsQuery) => AppsQuery)) => {
    const buildPatch = (patch: AppsQuery) => {
      const result: Partial<typeof urlQuery> = {}
      if ('tagIDs' in patch)
        result.tagIDs = patch.tagIDs && patch.tagIDs.length > 0 ? patch.tagIDs : null
      if ('keywords' in patch)
        result.keywords = patch.keywords ? patch.keywords : null
      if ('isCreatedByMe' in patch)
        result.isCreatedByMe = patch.isCreatedByMe ? true : null
      if ('sortBy' in patch)
        result.sortBy = patch.sortBy || '-created_at'
      return result
    }

    if (typeof next === 'function') {
      setUrlQuery(prev => buildPatch(next({
        tagIDs: prev.tagIDs ?? undefined,
        keywords: normalizeKeywords(prev.keywords),
        isCreatedByMe: prev.isCreatedByMe ?? false,
        sortBy: (prev.sortBy as AppSortBy) || '-created_at',
      })))
      return
    }

    setUrlQuery(buildPatch(next))
  }, [setUrlQuery])

  return useMemo(() => ({ query, setQuery }), [query, setQuery])
}

export default useAppsQueryState
