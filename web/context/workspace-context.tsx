'use client'

import useSWR from 'swr'
import { fetchWorkspaces } from '@/service/common'
import type { IWorkspace } from '@/models/common'
import { createSelectorCtx } from '@/utils/context'

export type WorkspacesContextValue = {
  workspaces: IWorkspace[]
}

const [, useWorkspacesContext, WorkspacesContext] = createSelectorCtx<WorkspacesContextValue>()

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

export { useWorkspacesContext }

export default WorkspacesContext
