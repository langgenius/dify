'use client'

import type { VibeCommandDetail } from './use-workflow-vibe/types'
import { useEffect } from 'react'
import { VIBE_APPLY_EVENT, VIBE_COMMAND_EVENT } from '../constants'
import { useVibeGeneratorApi } from './use-workflow-vibe/use-vibe-generator-api'
import { useWorkflowApplier } from './use-workflow-vibe/use-workflow-applier'
import { replaceVariableReferences as replaceVariableReferencesUtil } from './use-workflow-vibe/utils'

// Re-export for testing or other usages
export const replaceVariableReferences = replaceVariableReferencesUtil

export const useWorkflowVibe = () => {
  const { handleVibeCommand } = useVibeGeneratorApi()
  const { handleAccept } = useWorkflowApplier()

  useEffect(() => {
    const handler = (event: CustomEvent<VibeCommandDetail>) => {
      handleVibeCommand(event.detail?.dsl, false)
    }

    const acceptHandler = () => {
      handleAccept()
    }

    document.addEventListener(VIBE_COMMAND_EVENT, handler as EventListener)
    document.addEventListener(VIBE_APPLY_EVENT, acceptHandler as EventListener)

    return () => {
      document.removeEventListener(VIBE_COMMAND_EVENT, handler as EventListener)
      document.removeEventListener(VIBE_APPLY_EVENT, acceptHandler as EventListener)
    }
  }, [handleVibeCommand, handleAccept])
}
