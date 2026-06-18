'use client'

import type { ReactNode } from 'react'
import type { AgentOrchestrateAddAction, AgentOrchestrateAddActionKey, AgentOrchestrateAddActions } from './add-actions-context'
import { useCallback, useMemo, useState } from 'react'
import { AgentOrchestrateAddActionsContext } from './add-actions-context'
import { useAgentOrchestrateReadOnly } from './read-only-context'

export function AgentOrchestrateAddActionsProvider({
  children,
}: {
  children: ReactNode
}) {
  const readOnly = useAgentOrchestrateReadOnly()
  const [actions, setActions] = useState<AgentOrchestrateAddActions>({})

  const registerAction = useCallback((key: AgentOrchestrateAddActionKey, action: AgentOrchestrateAddAction) => {
    if (readOnly)
      return () => undefined

    setActions((currentActions) => {
      if (currentActions[key] === action)
        return currentActions

      return {
        ...currentActions,
        [key]: action,
      }
    })

    return () => {
      setActions((currentActions) => {
        if (currentActions[key] !== action)
          return currentActions

        const nextActions = { ...currentActions }
        delete nextActions[key]
        return nextActions
      })
    }
  }, [readOnly])

  const value = useMemo(() => ({
    actions: readOnly ? {} : actions,
    registerAction,
  }), [actions, readOnly, registerAction])

  return (
    <AgentOrchestrateAddActionsContext value={value}>
      {children}
    </AgentOrchestrateAddActionsContext>
  )
}
