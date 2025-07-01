import { useContext } from 'react'
import {
  noop,
} from 'lodash-es'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import { HooksStoreContext } from './provider'
import type { IOtherOptions } from '@/service/base'

type CommonHooksFnMap = {
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
  handleRun: (params: any, callback?: IOtherOptions,) => void
  handleStopRun: (...args: any[]) => void
  handleStartWorkflowRun: () => void
  handleWorkflowStartRunInWorkflow: () => void
  handleWorkflowStartRunInChatflow: () => void
  fetchInspectVars: () => Promise<void>
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
  fetchInspectVars = async () => noop(),
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
    fetchInspectVars,
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
