'use client'

import type { RefObject } from 'react'
import type { Plugin } from '../../plugins/types'
import type { SearchResult } from '../actions/types'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { VIBE_COMMAND_EVENT } from '@/app/components/workflow/constants'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { executeCommand } from '../actions/commands'
import { slashCommandRegistry } from '../actions/commands/registry'

export type UseGotoAnythingNavigationReturn = {
  handleCommandSelect: (commandKey: string) => void
  handleNavigate: (result: SearchResult) => void
  activePlugin: Plugin | undefined
  setActivePlugin: (plugin: Plugin | undefined) => void
}

export type UseGotoAnythingNavigationOptions = {
  setSearchQuery: (query: string) => void
  clearSelection: () => void
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}

export const useGotoAnythingNavigation = (
  options: UseGotoAnythingNavigationOptions,
): UseGotoAnythingNavigationReturn => {
  const {
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
        if (result.data.command === 'workflow.generate') {
          if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent(VIBE_COMMAND_EVENT, { detail: { dsl: result.data.args?.dsl } }))
          }
          break
        }

        // Execute slash commands using the command bus
        const { command, args } = result.data
        executeCommand(command, args)
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
  }, [router, onClose, setSearchQuery])

  return {
    handleCommandSelect,
    handleNavigate,
    activePlugin,
    setActivePlugin,
  }
}
