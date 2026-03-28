'use client'

import type { ActionItem } from '../actions/types'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { createActions, matchAction } from '../actions'
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
  Actions: Record<string, ActionItem>
}

export const useGotoAnythingSearch = (): UseGotoAnythingSearchReturn => {
  const { isWorkflowPage, isRagPipelinePage } = useGotoAnythingContext()
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [cmdVal, setCmdVal] = useState<string>('_')

  // Filter actions based on context
  const Actions = useMemo(() => {
    return createActions(isWorkflowPage, isRagPipelinePage)
  }, [isWorkflowPage, isRagPipelinePage])

  const searchQueryDebouncedValue = useDebounce(searchQuery.trim(), {
    wait: 300,
  })

  const isCommandsMode = useMemo(() => {
    const trimmed = searchQuery.trim()
    return trimmed === '@' || trimmed === '/'
      || (trimmed.startsWith('@') && !matchAction(trimmed, Actions))
      || (trimmed.startsWith('/') && !matchAction(trimmed, Actions))
  }, [searchQuery, Actions])

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
    const action = matchAction(query, Actions)

    if (!action)
      return 'general'

    return action.key === '/' ? '@command' : action.key
  }, [searchQueryDebouncedValue, Actions, isCommandsMode, searchQuery])

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
    Actions,
  }
}
