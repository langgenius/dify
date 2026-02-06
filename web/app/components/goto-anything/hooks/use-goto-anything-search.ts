'use client'

import type { ScopeDescriptor } from '../actions/types'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { matchAction, useGotoAnythingScopes } from '../actions'
import { ACTION_KEYS } from '../constants'
import { useGotoAnythingContext } from '../context'

export type UseGotoAnythingSearchReturn = {
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchQueryDebouncedValue: string
  searchMode: string
  isCommandsMode: boolean
  cmdVal: string
  setCmdVal: (val: string) => void
  clearSelection: () => void
  scopes: ScopeDescriptor[]
}

export const useGotoAnythingSearch = (): UseGotoAnythingSearchReturn => {
  const { isWorkflowPage, isRagPipelinePage } = useGotoAnythingContext()
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [cmdVal, setCmdVal] = useState<string>('_')

  // Fetch scopes from registry based on context
  const scopes = useGotoAnythingScopes({ isWorkflowPage, isRagPipelinePage })

  const searchQueryDebouncedValue = useDebounce(searchQuery.trim(), {
    wait: 300,
  })

  const isCommandsMode = useMemo(() => {
    const trimmed = searchQuery.trim()
    return trimmed === '@' || trimmed === '/'
      || (trimmed.startsWith('@') && !matchAction(trimmed, scopes))
      || (trimmed.startsWith('/') && !matchAction(trimmed, scopes))
  }, [searchQuery, scopes])

  const searchMode = useMemo(() => {
    if (isCommandsMode) {
      if (searchQuery.trim().startsWith('@'))
        return 'scopes'
      else if (searchQuery.trim().startsWith('/'))
        return 'commands'
      return 'commands'
    }

    const query = searchQueryDebouncedValue.toLowerCase()
    const action = matchAction(query, scopes)

    if (!action)
      return 'general'

    if (action.id === 'slash' || action.shortcut === ACTION_KEYS.SLASH)
      return '@command'

    return action.shortcut
  }, [searchQueryDebouncedValue, scopes, isCommandsMode, searchQuery])

  // Prevent automatic selection of the first option when cmdVal is not set
  const clearSelection = useCallback(() => {
    setCmdVal('_')
  }, [])

  return {
    searchQuery,
    setSearchQuery,
    searchQueryDebouncedValue,
    searchMode,
    isCommandsMode,
    cmdVal,
    setCmdVal,
    clearSelection,
    scopes,
  }
}
