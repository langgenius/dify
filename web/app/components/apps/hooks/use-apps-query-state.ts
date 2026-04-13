import { parseAsArrayOf, parseAsBoolean, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'

type AppsQuery = {
  tagIDs?: string[]
  keywords?: string
  isCreatedByMe?: boolean
}

const normalizeKeywords = (value: string | null) => value || undefined

function useAppsQueryState() {
  const [urlQuery, setUrlQuery] = useQueryStates(
    {
      tagIDs: parseAsArrayOf(parseAsString, ';'),
      keywords: parseAsString,
      isCreatedByMe: parseAsBoolean,
    },
    {
      history: 'push',
    },
  )

  const query = useMemo<AppsQuery>(() => ({
    tagIDs: urlQuery.tagIDs ?? undefined,
    keywords: normalizeKeywords(urlQuery.keywords),
    isCreatedByMe: urlQuery.isCreatedByMe ?? false,
  }), [urlQuery.isCreatedByMe, urlQuery.keywords, urlQuery.tagIDs])

  const setQuery = useCallback((next: AppsQuery | ((prev: AppsQuery) => AppsQuery)) => {
    const buildPatch = (patch: AppsQuery) => {
      const result: Partial<typeof urlQuery> = {}
      if ('tagIDs' in patch)
        result.tagIDs = patch.tagIDs && patch.tagIDs.length > 0 ? patch.tagIDs : null
      if ('keywords' in patch)
        result.keywords = patch.keywords ? patch.keywords : null
      if ('isCreatedByMe' in patch)
        result.isCreatedByMe = patch.isCreatedByMe ? true : null
      return result
    }

    if (typeof next === 'function') {
      setUrlQuery(prev => buildPatch(next({
        tagIDs: prev.tagIDs ?? undefined,
        keywords: normalizeKeywords(prev.keywords),
        isCreatedByMe: prev.isCreatedByMe ?? false,
      })))
      return
    }

    setUrlQuery(buildPatch(next))
  }, [setUrlQuery])

  return useMemo(() => ({ query, setQuery }), [query, setQuery])
}

export default useAppsQueryState
