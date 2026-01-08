import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useMemo } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { matchAction, searchAnything, useGotoAnythingScopes } from '../actions'
import { ACTION_KEYS } from '../constants'
import { useGotoAnythingContext } from '../context'

export const useSearch = (searchQuery: string) => {
  const defaultLocale = useGetLanguage()
  const { isWorkflowPage, isRagPipelinePage } = useGotoAnythingContext()

  // Fetch scopes from registry based on context
  const scopes = useGotoAnythingScopes({ isWorkflowPage, isRagPipelinePage })

  const searchQueryDebouncedValue = useDebounce(searchQuery.trim(), {
    wait: 300,
  })

  const isCommandsMode = searchQuery.trim() === '@' || searchQuery.trim() === '/'
    || (searchQuery.trim().startsWith('@') && !matchAction(searchQuery.trim(), scopes))
    || (searchQuery.trim().startsWith('/') && !matchAction(searchQuery.trim(), scopes))

  const searchMode = useMemo(() => {
    if (isCommandsMode) {
      // Distinguish between @ (scopes) and / (commands) mode
      if (searchQuery.trim().startsWith('@'))
        return 'scopes'
      else if (searchQuery.trim().startsWith('/'))
        return 'commands'
      return 'commands' // default fallback
    }

    const query = searchQueryDebouncedValue.toLowerCase()
    const action = matchAction(query, scopes)

    if (!action)
      return 'general'

    if (action.id === 'slash' || action.shortcut === ACTION_KEYS.SLASH)
      return '@command'

    return action.shortcut
  }, [searchQueryDebouncedValue, scopes, isCommandsMode, searchQuery])

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
      placeholderData: keepPreviousData,
    },
  )

  const dedupedResults = useMemo(() => {
    if (!searchQuery.trim())
      return []

    const seen = new Set<string>()
    return searchResults.filter((result) => {
      const key = `${result.type}-${result.id}`
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })
  }, [searchResults, searchQuery])

  return {
    scopes,
    searchResults: dedupedResults,
    isLoading,
    isError,
    error,
    searchMode,
    isCommandsMode,
  }
}
