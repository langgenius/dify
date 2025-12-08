'use client'

import { createContext, useContext } from 'use-context-selector'
import { useWorkspaces } from '@/service/use-common'
import type { IWorkspace } from '@/models/common'

export type WorkspacesContextValue = {
  workspaces: IWorkspace[]
}

const WorkspacesContext = createContext<WorkspacesContextValue>({
  workspaces: [],
})

type IWorkspaceProviderProps = {
  children: React.ReactNode
}

export const WorkspaceProvider = ({
  children,
}: IWorkspaceProviderProps) => {
  const { data } = useWorkspaces()

  return (
    <WorkspacesContext.Provider value={{
      workspaces: data?.workspaces || [],
    }}>
      {children}
    </WorkspacesContext.Provider>
  )
}

export const useWorkspacesContext = () => useContext(WorkspacesContext)

export default WorkspacesContext
