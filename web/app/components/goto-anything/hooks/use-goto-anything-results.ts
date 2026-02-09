'use client'

import type { ScopeDescriptor, SearchResult } from '../actions/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { matchAction, searchAnything } from '../actions'

export type UseGotoAnythingResultsReturn = {
  searchResults: SearchResult[]
  dedupedResults: SearchResult[]
  groupedResults: Record<string, SearchResult[]>
  isLoading: boolean
  isError: boolean
  error: Error | null
}

export type UseGotoAnythingResultsOptions = {
  searchQueryDebouncedValue: string
  searchMode: string
  isCommandsMode: boolean
  scopes: ScopeDescriptor[]
  isWorkflowPage: boolean
  isRagPipelinePage: boolean
  cmdVal: string
  setCmdVal: (val: string) => void
}

export const useGotoAnythingResults = (
  options: UseGotoAnythingResultsOptions,
): UseGotoAnythingResultsReturn => {
  const {
    searchQueryDebouncedValue,
    searchMode,
    isCommandsMode,
    scopes,
    isWorkflowPage,
    isRagPipelinePage,
    cmdVal,
    setCmdVal,
  } = options

  const defaultLocale = useGetLanguage()

  const { data: searchResults = [], isLoading, isError, error } = useQuery(
    {
      // eslint-disable-next-line @tanstack/query/exhaustive-deps -- scopes intentionally excluded: contains non-serializable functions; scope IDs provide stable representation
      queryKey: [
        'goto-anything',
        'search-result',
        searchQueryDebouncedValue,
        searchMode,
        isWorkflowPage,
        isRagPipelinePage,
        defaultLocale,
        scopes.map(s => s.id).sort().join(','),
      ],
      queryFn: async () => {
        const query = searchQueryDebouncedValue.toLowerCase()
        const scope = matchAction(query, scopes)
        return await searchAnything(defaultLocale, query, scope, scopes)
      },
      enabled: !!searchQueryDebouncedValue && !isCommandsMode,
      staleTime: 30000,
      gcTime: 300000,
    },
  )

  const dedupedResults = useMemo(() => {
    const seen = new Set<string>()
    return searchResults.filter((result) => {
      const key = `${result.type}-${result.id}`
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })
  }, [searchResults])

  // Group results by type
  const groupedResults = useMemo(() => dedupedResults.reduce((acc, result) => {
    if (!acc[result.type])
      acc[result.type] = []

    acc[result.type].push(result)
    return acc
  }, {} as Record<string, SearchResult[]>), [dedupedResults])

  // Auto-select first result when results change
  useEffect(() => {
    if (isCommandsMode)
      return

    if (!dedupedResults.length)
      return

    const currentValueExists = dedupedResults.some(result => `${result.type}-${result.id}` === cmdVal)

    if (!currentValueExists)
      setCmdVal(`${dedupedResults[0].type}-${dedupedResults[0].id}`)
  }, [isCommandsMode, dedupedResults, cmdVal, setCmdVal])

  return {
    searchResults,
    dedupedResults,
    groupedResults,
    isLoading,
    isError,
    error: error as Error | null,
  }
}
