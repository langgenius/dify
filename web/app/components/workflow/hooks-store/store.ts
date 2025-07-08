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
import type { VarInInspect } from '@/types/workflow'
import type {
  Node,
  ValueSelector,
} from '@/app/components/workflow/types'

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
  hasNodeInspectVars: (nodeId: string) => boolean
  hasSetInspectVar: (nodeId: string, name: string, sysVars: VarInInspect[], conversationVars: VarInInspect[]) => boolean
  fetchInspectVarValue: (selector: ValueSelector) => Promise<void>
  editInspectVarValue: (nodeId: string, varId: string, value: any) => Promise<void>
  renameInspectVarName: (nodeId: string, oldName: string, newName: string) => Promise<void>
  appendNodeInspectVars: (nodeId: string, payload: VarInInspect[], allNodes: Node[]) => void
  deleteInspectVar: (nodeId: string, varId: string) => Promise<void>
  deleteNodeInspectorVars: (nodeId: string) => Promise<void>
  deleteAllInspectorVars: () => Promise<void>
  isInspectVarEdited: (nodeId: string, name: string) => boolean
  resetToLastRunVar: (nodeId: string, varId: string) => Promise<void>
  invalidateSysVarValues: () => void
  resetConversationVar: (varId: string) => Promise<void>
  invalidateConversationVarValues: () => void
  configsMap?: {
    conversationVarsUrl: string
    systemVarsUrl: string
  }
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
  hasNodeInspectVars = () => false,
  hasSetInspectVar = () => false,
  fetchInspectVarValue = async () => noop(),
  editInspectVarValue = async () => noop(),
  renameInspectVarName = async () => noop(),
  appendNodeInspectVars = () => noop(),
  deleteInspectVar = async () => noop(),
  deleteNodeInspectorVars = async () => noop(),
  deleteAllInspectorVars = async () => noop(),
  isInspectVarEdited = () => false,
  resetToLastRunVar = async () => noop(),
  invalidateSysVarValues = noop,
  resetConversationVar = async () => noop(),
  invalidateConversationVarValues = noop,
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
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
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
