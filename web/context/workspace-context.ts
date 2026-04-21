'use client'

import type { IWorkspace } from '@/models/common'
import { createContext, useContext } from 'use-context-selector'

type WorkspacesContextValue = {
  workspaces: IWorkspace[]
}

export const WorkspacesContext = createContext<WorkspacesContextValue>({
  workspaces: [],
})

export const useWorkspacesContext = () => useContext(WorkspacesContext)
