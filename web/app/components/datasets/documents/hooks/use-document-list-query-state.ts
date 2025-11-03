import { type ReadonlyURLSearchParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'

export type DocumentListQuery = {
  page: number
  limit: number
  keyword: string
}

const DEFAULT_QUERY: DocumentListQuery = {
  page: 1,
  limit: 10,
  keyword: '',
}

// Parse the query parameters from the URL search string.
function parseParams(params: ReadonlyURLSearchParams): DocumentListQuery {
  const page = Number.parseInt(params.get('page') || '1', 10)
  const limit = Number.parseInt(params.get('limit') || '10', 10)
  const keyword = params.get('keyword') || ''

  return {
    page: page > 0 ? page : 1,
    limit: (limit > 0 && limit <= 100) ? limit : 10,
    keyword: keyword ? decodeURIComponent(keyword) : '',
  }
}

// Update the URL search string with the given query parameters.
function updateSearchParams(query: DocumentListQuery, searchParams: URLSearchParams) {
  const { page, limit, keyword } = query || {}

  const hasNonDefaultParams = (page && page > 1) || (limit && limit !== 10) || (keyword && keyword.trim())

  if (hasNonDefaultParams) {
    searchParams.set('page', (page || 1).toString())
    searchParams.set('limit', (limit || 10).toString())
  }
  else {
    searchParams.delete('page')
    searchParams.delete('limit')
  }

  if (keyword && keyword.trim())
    searchParams.set('keyword', encodeURIComponent(keyword))
  else
    searchParams.delete('keyword')
}

function useDocumentListQueryState() {
  const searchParams = useSearchParams()
  const query = useMemo(() => parseParams(searchParams), [searchParams])

  const router = useRouter()
  const pathname = usePathname()

  // Helper function to update specific query parameters
  const updateQuery = useCallback((updates: Partial<DocumentListQuery>) => {
    const newQuery = { ...query, ...updates }
    const params = new URLSearchParams()
    updateSearchParams(newQuery, params)
    const search = params.toString()
    const queryString = search ? `?${search}` : ''
    router.push(`${pathname}${queryString}`, { scroll: false })
  }, [query, router, pathname])

  // Helper function to reset query to defaults
  const resetQuery = useCallback(() => {
    const params = new URLSearchParams()
    updateSearchParams(DEFAULT_QUERY, params)
    const search = params.toString()
    const queryString = search ? `?${search}` : ''
    router.push(`${pathname}${queryString}`, { scroll: false })
  }, [router, pathname])

  return useMemo(() => ({
    query,
    updateQuery,
    resetQuery,
  }), [query, updateQuery, resetQuery])
}

export default useDocumentListQueryState
