import { type ReadonlyURLSearchParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

type AppsQuery = {
  tagIDs?: string[]
  keywords?: string
  isCreatedByMe?: boolean
}

// Parse the query parameters from the URL search string.
function parseParams(params: ReadonlyURLSearchParams): AppsQuery {
  const tagIDs = params.get('tagIDs')?.split(';')
  const keywords = params.get('keywords') || undefined
  const isCreatedByMe = params.get('isCreatedByMe') === 'true'
  return { tagIDs, keywords, isCreatedByMe }
}

// Update the URL search string with the given query parameters.
function updateSearchParams(query: AppsQuery, current: URLSearchParams) {
  const { tagIDs, keywords, isCreatedByMe } = query || {}

  if (tagIDs && tagIDs.length > 0)
    current.set('tagIDs', tagIDs.join(';'))
  else
    current.delete('tagIDs')

  if (keywords)
    current.set('keywords', keywords)
  else
    current.delete('keywords')

  if (isCreatedByMe)
    current.set('isCreatedByMe', 'true')
  else
    current.delete('isCreatedByMe')
}

function useAppsQueryState() {
  const searchParams = useSearchParams()
  const [query, setQuery] = useState<AppsQuery>(() => parseParams(searchParams))

  const router = useRouter()
  const pathname = usePathname()
  const syncSearchParams = useCallback((params: URLSearchParams) => {
    const search = params.toString()
    const query = search ? `?${search}` : ''
    router.push(`${pathname}${query}`, { scroll: false })
  }, [router, pathname])

  // Update the URL search string whenever the query changes.
  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    updateSearchParams(query, params)
    syncSearchParams(params)
  }, [query, searchParams, syncSearchParams])

  return useMemo(() => ({ query, setQuery }), [query])
}

export default useAppsQueryState
