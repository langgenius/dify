import type { WorkflowAppStore } from '../store/workflow'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { createWorkflowSlice } from '../store/workflow/workflow-slice'

export const createWorkflowAppStore = () =>
  createWorkflowStore({
    injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
  }) as WorkflowAppStore
