'use client'

import type { ReactNode } from 'react'
import type {
  AgentOrchestrateAddAction,
  AgentOrchestrateAddActionKey,
  AgentOrchestrateAddActions,
} from './add-actions-context'
import { useCallback, useMemo, useState } from 'react'
import { AgentOrchestrateAddActionsContext } from './add-actions-context'
import { useAgentOrchestrateViewingVersion } from './read-only-context'

export function AgentOrchestrateAddActionsProvider({ children }: { children: ReactNode }) {
  const isViewingVersion = useAgentOrchestrateViewingVersion()
  const [actions, setActions] = useState<AgentOrchestrateAddActions>({})

  const registerAction = useCallback(
    (key: AgentOrchestrateAddActionKey, action: AgentOrchestrateAddAction) => {
      if (isViewingVersion) return () => undefined

      setActions((currentActions) => {
        if (currentActions[key] === action) return currentActions

        return {
          ...currentActions,
          [key]: action,
        }
      })

      return () => {
        setActions((currentActions) => {
          if (currentActions[key] !== action) return currentActions

          const nextActions = { ...currentActions }
          delete nextActions[key]
          return nextActions
        })
      }
    },
    [isViewingVersion],
  )

  const value = useMemo(
    () => ({
      actions: isViewingVersion ? {} : actions,
      registerAction,
    }),
    [actions, isViewingVersion, registerAction],
  )

  return (
    <AgentOrchestrateAddActionsContext value={value}>{children}</AgentOrchestrateAddActionsContext>
  )
}
