'use client'

import type { RefObject } from 'react'
import type { Plugin } from '../../plugins/types'
import type { ActionItem, SearchResult } from '../actions/types'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { slashCommandRegistry } from '../actions/commands/registry'

export type UseGotoAnythingNavigationReturn = {
  handleCommandSelect: (commandKey: string) => void
  handleNavigate: (result: SearchResult) => void
  activePlugin: Plugin | undefined
  setActivePlugin: (plugin: Plugin | undefined) => void
}

export type UseGotoAnythingNavigationOptions = {
  Actions: Record<string, ActionItem>
  setSearchQuery: (query: string) => void
  clearSelection: () => void
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}

export const useGotoAnythingNavigation = (
  options: UseGotoAnythingNavigationOptions,
): UseGotoAnythingNavigationReturn => {
  const {
    Actions,
    setSearchQuery,
    clearSelection,
    inputRef,
    onClose,
  } = options

  const router = useRouter()
  const [activePlugin, setActivePlugin] = useState<Plugin>()

  const handleCommandSelect = useCallback((commandKey: string) => {
    // Check if it's a slash command
    if (commandKey.startsWith('/')) {
      const commandName = commandKey.substring(1)
      const handler = slashCommandRegistry.findCommand(commandName)

      // If it's a direct mode command, execute immediately
      if (handler?.mode === 'direct' && handler.execute) {
        handler.execute()
        onClose()
        setSearchQuery('')
        return
      }
    }

    // Otherwise, proceed with the normal flow (submenu mode)
    setSearchQuery(`${commandKey} `)
    clearSelection()
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }, [onClose, setSearchQuery, clearSelection, inputRef])

  // Handle navigation to selected result
  const handleNavigate = useCallback((result: SearchResult) => {
    onClose()
    setSearchQuery('')

    switch (result.type) {
      case 'command': {
        // Execute slash commands
        const action = Actions.slash
        action?.action?.(result)
        break
      }
      case 'plugin':
        setActivePlugin(result.data)
        break
      case 'workflow-node':
        // Handle workflow node selection and navigation
        if (result.metadata?.nodeId)
          selectWorkflowNode(result.metadata.nodeId, true)

        break
      default:
        if (result.path)
          router.push(result.path)
    }
  }, [router, Actions, onClose, setSearchQuery])

  return {
    handleCommandSelect,
    handleNavigate,
    activePlugin,
    setActivePlugin,
  }
}
