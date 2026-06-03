'use client'

import type { ActionItem, RecentSearchResult, SearchResult } from '../actions/types'
import { RiTimeLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { matchAction, searchAnything } from '../actions'
import { getRecentItems } from '../actions/recent-store'

type UseGotoAnythingResultsReturn = {
  searchResults: SearchResult[]
  dedupedResults: SearchResult[]
  groupedResults: Record<string, SearchResult[]>
  isLoading: boolean
  isError: boolean
  error: Error | null
}

type UseGotoAnythingResultsOptions = {
  searchQueryDebouncedValue: string
  searchMode: string
  isCommandsMode: boolean
  Actions: Record<string, ActionItem>
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
    Actions,
    isWorkflowPage,
    isRagPipelinePage,
    cmdVal,
    setCmdVal,
  } = options

  const defaultLocale = useGetLanguage()

  // Use action keys as stable cache key instead of the full Actions object
  // (Actions contains functions which are not serializable)
  const actionKeys = useMemo(() => Object.keys(Actions).sort(), [Actions])

  const { data: searchResults = [], isLoading, isError, error } = useQuery(
    {

      queryKey: [
        'goto-anything',
        'search-result',
        searchQueryDebouncedValue,
        searchMode,
        isWorkflowPage,
        isRagPipelinePage,
        defaultLocale,
        actionKeys,
      ],
      queryFn: async () => {
        const query = searchQueryDebouncedValue.toLowerCase()
        const action = matchAction(query, Actions)
        return await searchAnything(defaultLocale, query, action, Actions)
      },
      enabled: !!searchQueryDebouncedValue && !isCommandsMode,
      staleTime: 30000,
      gcTime: 300000,
    },
  )

  // Build recent items to show when search is empty
  const recentResults = useMemo((): RecentSearchResult[] => {
    if (searchQueryDebouncedValue || isCommandsMode)
      return []
    return getRecentItems().map(item => ({
      id: `recent-${item.id}`,
      title: item.title,
      description: item.description,
      type: 'recent' as const,
      originalType: item.originalType,
      path: item.path,
      icon: React.createElement(
        'div',
        { className: 'flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg' },
        React.createElement(RiTimeLine, { className: 'h-4 w-4 text-text-tertiary' }),
      ),
      data: { path: item.path },
    }))
  }, [searchQueryDebouncedValue, isCommandsMode])

  const dedupedResults = useMemo(() => {
    const allResults = recentResults.length ? recentResults : searchResults
    const seen = new Set<string>()
    return allResults.filter((result) => {
      const key = `${result.type}-${result.id}`
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })
  }, [searchResults, recentResults])

  // Group results by type
  const groupedResults = useMemo(() => dedupedResults.reduce((acc, result) => {
    if (!acc[result.type])
      acc[result.type] = []

    acc[result.type]!.push(result)
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
      setCmdVal(`${dedupedResults[0]!.type}-${dedupedResults[0]!.id}`)
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
