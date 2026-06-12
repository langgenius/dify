'use client'

import type { ReactNode } from 'react'
import type { AgentOrchestrateAddAction, AgentOrchestrateAddActionKey, AgentOrchestrateAddActions } from './add-actions-context'
import { useCallback, useMemo, useState } from 'react'
import { AgentOrchestrateAddActionsContext } from './add-actions-context'

export function AgentOrchestrateAddActionsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [actions, setActions] = useState<AgentOrchestrateAddActions>({})

  const registerAction = useCallback((key: AgentOrchestrateAddActionKey, action: AgentOrchestrateAddAction) => {
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
  }, [])

  const value = useMemo(() => ({
    actions,
    registerAction,
  }), [actions, registerAction])

  return (
    <AgentOrchestrateAddActionsContext value={value}>
      {children}
    </AgentOrchestrateAddActionsContext>
  )
}
