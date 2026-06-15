'use client'

import type { ReactNode } from 'react'
import { useWorkspaces } from '@/service/use-common'
import { WorkspacesContext } from './workspace-context'

type WorkspaceProviderProps = {
  children: ReactNode
}

export const WorkspaceProvider = ({
  children,
}: WorkspaceProviderProps) => {
  const { data } = useWorkspaces()

  return (
    <WorkspacesContext.Provider value={{
      workspaces: data?.workspaces || [],
    }}
    >
      {children}
    </WorkspacesContext.Provider>
  )
}
