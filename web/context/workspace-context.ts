'use client'

import type { IWorkspace } from '@/models/common'
import { createContext, use } from 'use-context-selector'

type WorkspacesContextValue = {
  workspaces: IWorkspace[]
}

export const WorkspacesContext = createContext<WorkspacesContextValue>({
  workspaces: [],
})

export const useWorkspacesContext = () => use(WorkspacesContext)
