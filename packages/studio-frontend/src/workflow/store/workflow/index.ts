import type { TemporalState } from 'zundo'
import type {
  StateCreator,
  StoreApi,
} from 'zustand'
import type { ChatVariableSliceShape } from '@/app/components/workflow/store/workflow/chat-variable-slice'
import type { CommentSliceShape } from '@/app/components/workflow/store/workflow/comment-slice'
import type { InspectVarsSliceShape } from '@/app/components/workflow/store/workflow/debug/inspect-vars-slice'
import type { EnvVariableSliceShape } from '@/app/components/workflow/store/workflow/env-variable-slice'
import type { FormSliceShape } from '@/app/components/workflow/store/workflow/form-slice'
import type { HelpLineSliceShape } from '@/app/components/workflow/store/workflow/help-line-slice'
import type { HistorySliceShape, WorkflowHistoryTemporalState } from '@/app/components/workflow/store/workflow/history-slice'
import type { LayoutSliceShape } from '@/app/components/workflow/store/workflow/layout-slice'
import type { NodeSliceShape } from '@/app/components/workflow/store/workflow/node-slice'
import type { PanelSliceShape } from '@/app/components/workflow/store/workflow/panel-slice'
import type { ToolSliceShape } from '@/app/components/workflow/store/workflow/tool-slice'
import type { VersionSliceShape } from '@/app/components/workflow/store/workflow/version-slice'
import type { WorkflowDraftSliceShape } from '@/app/components/workflow/store/workflow/workflow-draft-slice'
import type { WorkflowSliceShape } from '@/app/components/workflow/store/workflow/workflow-slice'
import type { RagPipelineSliceShape } from '@/app/components/rag-pipeline/store'
import type { WorkflowSliceShape as WorkflowAppSliceShape } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import { use } from 'react'
import { temporal } from 'zundo'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createChatVariableSlice } from '@/app/components/workflow/store/workflow/chat-variable-slice'
import { createCommentSlice } from '@/app/components/workflow/store/workflow/comment-slice'
import { createInspectVarsSlice } from '@/app/components/workflow/store/workflow/debug/inspect-vars-slice'
import { createEnvVariableSlice } from '@/app/components/workflow/store/workflow/env-variable-slice'
import { createFormSlice } from '@/app/components/workflow/store/workflow/form-slice'
import { createHelpLineSlice } from '@/app/components/workflow/store/workflow/help-line-slice'
import {
  createHistorySlice,
  getWorkflowHistoryTemporalState,
  isWorkflowHistoryTemporalStateEqual,
} from '@/app/components/workflow/store/workflow/history-slice'
import { createLayoutSlice } from '@/app/components/workflow/store/workflow/layout-slice'
import { createNodeSlice } from '@/app/components/workflow/store/workflow/node-slice'

import { createPanelSlice } from '@/app/components/workflow/store/workflow/panel-slice'
import { createToolSlice } from '@/app/components/workflow/store/workflow/tool-slice'
import { createVersionSlice } from '@/app/components/workflow/store/workflow/version-slice'
import { createWorkflowDraftSlice } from '@/app/components/workflow/store/workflow/workflow-draft-slice'
import { createWorkflowSlice } from '@/app/components/workflow/store/workflow/workflow-slice'

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
