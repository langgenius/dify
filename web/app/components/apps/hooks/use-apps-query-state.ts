import { type ReadonlyURLSearchParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'

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
  const query = useMemo(() => parseParams(searchParams), [searchParams])

  const router = useRouter()
  const pathname = usePathname()

  const queryRef = useRef(query)
  useEffect(() => {
    queryRef.current = query
  }, [query])

  const setQuery = useCallback(
    (updater: (prev: AppsQuery) => AppsQuery) => {
      const newQuery = updater(queryRef.current)
      const params = new URLSearchParams()
      updateSearchParams(newQuery, params)
      const search = params.toString()
      const queryString = search ? `?${search}` : ''
      router.push(`${pathname}${queryString}`, { scroll: false })
    },
    [router, pathname],
  )

  return useMemo(() => ({ query, setQuery }), [query, setQuery])
}

export default useAppsQueryState
