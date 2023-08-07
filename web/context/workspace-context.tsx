'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { useEffect, useState } from 'react'
import { fetchWorkspaces } from '@/service/common'
import type { IWorkspace } from '@/models/common'

export type WorkspacesContextValue = {
  workspaces: IWorkspace[]
  reloadWorkspaces?: () => void
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
  const [workspaces, setWorkspaces] = useState<IWorkspace[]>([])
  const { data, mutate } = useSWR({ url: '/workspaces' }, fetchWorkspaces)

  useEffect(() => {
    if (data?.workspaces) {
      // update workspaces context after data is fetched
      setWorkspaces(data.workspaces)
    }
  }, [data])

  return (
    <WorkspacesContext.Provider value={{
      workspaces,
      reloadWorkspaces: mutate,
    }}>
      {children}
    </WorkspacesContext.Provider>
  )
}

export const useWorkspacesContext = () => useContext(WorkspacesContext)

export default WorkspacesContext
