import type { TemporalState } from 'zundo'
import type {
  StateCreator,
  StoreApi,
} from 'zustand'
import type { ChatVariableSliceShape } from '../../store/workflow/chat-variable-slice'
import type { CommentSliceShape } from '../../store/workflow/comment-slice'
import type { InspectVarsSliceShape } from '../../store/workflow/debug/inspect-vars-slice'
import type { EnvVariableSliceShape } from '../../store/workflow/env-variable-slice'
import type { FormSliceShape } from '../../store/workflow/form-slice'
import type { HelpLineSliceShape } from '../../store/workflow/help-line-slice'
import type { HistorySliceShape, WorkflowHistoryTemporalState } from '../../store/workflow/history-slice'
import type { LayoutSliceShape } from '../../store/workflow/layout-slice'
import type { NodeSliceShape } from '../../store/workflow/node-slice'
import type { PanelSliceShape } from '../../store/workflow/panel-slice'
import type { ToolSliceShape } from '../../store/workflow/tool-slice'
import type { VersionSliceShape } from '../../store/workflow/version-slice'
import type { WorkflowDraftSliceShape } from '../../store/workflow/workflow-draft-slice'
import type { WorkflowSliceShape } from '../../store/workflow/workflow-slice'
import type { RagPipelineSliceShape } from '@/app/components/rag-pipeline/store'
import type { WorkflowSliceShape as WorkflowAppSliceShape } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import { use } from 'react'
import { temporal } from 'zundo'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { WorkflowContext } from '../../context'
import { createChatVariableSlice } from '../../store/workflow/chat-variable-slice'
import { createCommentSlice } from '../../store/workflow/comment-slice'
import { createInspectVarsSlice } from '../../store/workflow/debug/inspect-vars-slice'
import { createEnvVariableSlice } from '../../store/workflow/env-variable-slice'
import { createFormSlice } from '../../store/workflow/form-slice'
import { createHelpLineSlice } from '../../store/workflow/help-line-slice'
import {
  createHistorySlice,
  getWorkflowHistoryTemporalState,
  isWorkflowHistoryTemporalStateEqual,
} from '../../store/workflow/history-slice'
import { createLayoutSlice } from '../../store/workflow/layout-slice'
import { createNodeSlice } from '../../store/workflow/node-slice'

import { createPanelSlice } from '../../store/workflow/panel-slice'
import { createToolSlice } from '../../store/workflow/tool-slice'
import { createVersionSlice } from '../../store/workflow/version-slice'
import { createWorkflowDraftSlice } from '../../store/workflow/workflow-draft-slice'
import { createWorkflowSlice } from '../../store/workflow/workflow-slice'

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
    & CommentSliceShape
    & InspectVarsSliceShape
    & LayoutSliceShape
    & SliceFromInjection

type WorkflowStoreApi = StoreApi<Shape> & {
  temporal: StoreApi<TemporalState<WorkflowHistoryTemporalState>>
}

export type InjectWorkflowStoreSliceFn = StateCreator<SliceFromInjection>

type CreateWorkflowStoreParams = {
  injectWorkflowStoreSliceFn?: InjectWorkflowStoreSliceFn
}

export const createWorkflowStore = (params: CreateWorkflowStoreParams) => {
  const { injectWorkflowStoreSliceFn } = params || {}

  return createStore<Shape>()(
    temporal<Shape, [], [], WorkflowHistoryTemporalState>(
      (...args) => ({
        ...createChatVariableSlice(...args),
        ...createEnvVariableSlice(...args),
        ...createFormSlice(...args),
        ...createHelpLineSlice(...args),
        ...createHistorySlice(...args),
        ...createNodeSlice(...args),
        ...createPanelSlice(...args),
        ...createCommentSlice(...args),
        ...createToolSlice(...args),
        ...createVersionSlice(...args),
        ...createWorkflowDraftSlice(...args),
        ...createWorkflowSlice(...args),
        ...createInspectVarsSlice(...args),
        ...createLayoutSlice(...args),
        ...(injectWorkflowStoreSliceFn?.(...args) || {} as SliceFromInjection),
      }),
      {
        partialize: getWorkflowHistoryTemporalState,
        equality: isWorkflowHistoryTemporalStateEqual,
      },
    ),
  ) as WorkflowStoreApi
}

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = use(WorkflowContext)
  if (!store)
    throw new Error('Missing WorkflowContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useWorkflowStore = () => {
  return use(WorkflowContext)!
}
