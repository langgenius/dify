import type {
  StateCreator,
} from 'zustand'
import type { ChatVariableSliceShape } from './chat-variable-slice'
import type { InspectVarsSliceShape } from './debug/inspect-vars-slice'
import type { EnvVariableSliceShape } from './env-variable-slice'
import type { FormSliceShape } from './form-slice'
import type { HelpLineSliceShape } from './help-line-slice'
import type { HistorySliceShape } from './history-slice'
import type { LayoutSliceShape } from './layout-slice'
import type { NodeSliceShape } from './node-slice'
import type { PanelSliceShape } from './panel-slice'
import type { ToolSliceShape } from './tool-slice'
import type { VersionSliceShape } from './version-slice'
import type { WorkflowDraftSliceShape } from './workflow-draft-slice'
import type { WorkflowSliceShape } from './workflow-slice'
import type { RagPipelineSliceShape } from '@/app/components/rag-pipeline/store'
import type { WorkflowSliceShape as WorkflowAppSliceShape } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import { useContext } from 'react'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createChatVariableSlice } from './chat-variable-slice'
import { createInspectVarsSlice } from './debug/inspect-vars-slice'
import { createEnvVariableSlice } from './env-variable-slice'
import { createFormSlice } from './form-slice'
import { createHelpLineSlice } from './help-line-slice'
import { createHistorySlice } from './history-slice'
import { createLayoutSlice } from './layout-slice'
import { createNodeSlice } from './node-slice'

import { createPanelSlice } from './panel-slice'
import { createToolSlice } from './tool-slice'
import { createVersionSlice } from './version-slice'
import { createWorkflowDraftSlice } from './workflow-draft-slice'
import { createWorkflowSlice } from './workflow-slice'

export type SliceFromInjection
  = Partial<WorkflowAppSliceShape>
    & Partial<RagPipelineSliceShape>

export type Shape
  = ChatVariableSliceShape
    & EnvVariableSliceShape
    & FormSliceShape
    & HelpLineSliceShape
    & HistorySliceShape
    & NodeSliceShape
    & PanelSliceShape
    & ToolSliceShape
    & VersionSliceShape
    & WorkflowDraftSliceShape
    & WorkflowSliceShape
    & InspectVarsSliceShape
    & LayoutSliceShape
    & SliceFromInjection

export type InjectWorkflowStoreSliceFn = StateCreator<SliceFromInjection>

type CreateWorkflowStoreParams = {
  injectWorkflowStoreSliceFn?: InjectWorkflowStoreSliceFn
}

export const createWorkflowStore = (params: CreateWorkflowStoreParams) => {
  const { injectWorkflowStoreSliceFn } = params || {}

  return createStore<Shape>((...args) => ({
    ...createChatVariableSlice(...args),
    ...createEnvVariableSlice(...args),
    ...createFormSlice(...args),
    ...createHelpLineSlice(...args),
    ...createHistorySlice(...args),
    ...createNodeSlice(...args),
    ...createPanelSlice(...args),
    ...createToolSlice(...args),
    ...createVersionSlice(...args),
    ...createWorkflowDraftSlice(...args),
    ...createWorkflowSlice(...args),
    ...createInspectVarsSlice(...args),
    ...createLayoutSlice(...args),
    ...(injectWorkflowStoreSliceFn?.(...args) || {} as SliceFromInjection),
  }))
}

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = useContext(WorkflowContext)
  if (!store)
    throw new Error('Missing WorkflowContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useWorkflowStore = () => {
  return useContext(WorkflowContext)!
}
