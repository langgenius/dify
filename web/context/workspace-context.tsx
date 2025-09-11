'use client'

import { createContext, use } from 'react'
import useSWR from 'swr'
import { fetchWorkspaces } from '@/service/common'
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
  const { data } = useSWR({ url: '/workspaces' }, fetchWorkspaces)

  return (
    <WorkspacesContext.Provider value={{
      workspaces: data?.workspaces || [],
    }}>
      {children}
    </WorkspacesContext.Provider>
  )
}

export const useWorkspacesContext = () => use(WorkspacesContext)

export default WorkspacesContext
