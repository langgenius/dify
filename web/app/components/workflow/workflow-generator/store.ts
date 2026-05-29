'use client'
import type { WorkflowGeneratorMode } from './types'
import { create } from 'zustand'

type WorkflowGeneratorStore = {
  isOpen: boolean
  mode: WorkflowGeneratorMode
  currentAppId: string | null
  currentAppMode: WorkflowGeneratorMode | null
  openGenerator: (params: {
    mode: WorkflowGeneratorMode
    currentAppId?: string | null
    currentAppMode?: WorkflowGeneratorMode | null
  }) => void
  closeGenerator: () => void
}

export const useWorkflowGeneratorStore = create<WorkflowGeneratorStore>(set => ({
  isOpen: false,
  mode: 'workflow',
  currentAppId: null,
  currentAppMode: null,
  openGenerator: ({ mode, currentAppId = null, currentAppMode = null }) =>
    set({ isOpen: true, mode, currentAppId, currentAppMode }),
  closeGenerator: () => set({ isOpen: false }),
}))
