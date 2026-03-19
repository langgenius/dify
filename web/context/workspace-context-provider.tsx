'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useWorkspaces } from '@/service/use-common'
import { WorkspacesContext } from './workspace-context'

type WorkspaceProviderProps = {
  children: ReactNode
}

export const WorkspaceProvider = ({
  children,
}: WorkspaceProviderProps) => {
  const { data } = useWorkspaces()

  const contextValue = useMemo(() => ({
    workspaces: data?.workspaces || [],
  }), [data?.workspaces])

  return (
    <WorkspacesContext.Provider value={contextValue}>
      {children}
    </WorkspacesContext.Provider>
  )
}
