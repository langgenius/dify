import { useContext } from 'react'
import {
  noop,
} from 'lodash-es'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { HooksStoreContext } from './provider'
import type {
  BlockEnum,
  NodeDefault,
} from '@/app/components/workflow/types'

export type AvailableNodesMetaData = {
  nodes: NodeDefault[]
  nodesMap?: Record<BlockEnum, NodeDefault<any>>
}
export type CommonHooksFnMap = {
  doSyncWorkflowDraft: (
    notRefreshWhenSyncError?: boolean,
    callback?: {
      onSuccess?: () => void
      onError?: () => void
      onSettled?: () => void
    }
  ) => Promise<void>
  syncWorkflowDraftWhenPageClose: () => void
  handleRefreshWorkflowDraft: () => void
  handleBackupDraft: () => void
  handleLoadBackupDraft: () => void
  handleRestoreFromPublishedWorkflow: (...args: any[]) => void
  handleRun: (...args: any[]) => void
  handleStopRun: (...args: any[]) => void
  handleStartWorkflowRun: () => void
  handleWorkflowStartRunInWorkflow: () => void
  handleWorkflowStartRunInChatflow: () => void
  availableNodesMetaData?: AvailableNodesMetaData
  getWorkflowRunAndTraceUrl: (runId?: string) => { runUrl: string; traceUrl: string }
  exportCheck?: () => Promise<void>
  handleExportDSL?: (include?: boolean) => Promise<void>
}

export type Shape = {
  refreshAll: (props: Partial<CommonHooksFnMap>) => void
} & CommonHooksFnMap

export const createHooksStore = ({
  doSyncWorkflowDraft = async () => noop(),
  syncWorkflowDraftWhenPageClose = noop,
  handleRefreshWorkflowDraft = noop,
  handleBackupDraft = noop,
  handleLoadBackupDraft = noop,
  handleRestoreFromPublishedWorkflow = noop,
  handleRun = noop,
  handleStopRun = noop,
  handleStartWorkflowRun = noop,
  handleWorkflowStartRunInWorkflow = noop,
  handleWorkflowStartRunInChatflow = noop,
  availableNodesMetaData = {
    nodes: [],
  },
  getWorkflowRunAndTraceUrl = () => ({
    runUrl: '',
    traceUrl: '',
  }),
  exportCheck = async () => noop(),
  handleExportDSL = async () => noop(),
}: Partial<Shape>) => {
  return createStore<Shape>(set => ({
    refreshAll: props => set(state => ({ ...state, ...props })),
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
    handleRefreshWorkflowDraft,
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
    handleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowStartRunInChatflow,
    availableNodesMetaData,
    getWorkflowRunAndTraceUrl,
    exportCheck,
    handleExportDSL,
  }))
}

export function useHooksStore<T>(selector: (state: Shape) => T): T {
  const store = useContext(HooksStoreContext)
  if (!store)
    throw new Error('Missing HooksStoreContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useHooksStoreApi = () => {
  return useContext(HooksStoreContext)!
}
