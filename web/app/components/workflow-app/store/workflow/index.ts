import type { StoreApi } from 'zustand'
import type { WorkflowSliceShape } from './workflow-slice'
import type { createWorkflowStore, Shape } from '@/app/components/workflow/store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'

export type WorkflowAppState = Shape & WorkflowSliceShape
export type WorkflowAppStore = Omit<
  ReturnType<typeof createWorkflowStore>,
  'getState' | 'setState'
> &
  StoreApi<WorkflowAppState>

export const useWorkflowAppStore = () => useWorkflowStore() as WorkflowAppStore

export function useWorkflowAppSelector<T>(selector: (state: WorkflowAppState) => T): T {
  return useStore((state) => selector(state as WorkflowAppState))
}
