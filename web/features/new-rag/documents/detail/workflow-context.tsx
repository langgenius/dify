'use client'

import type { BackgroundTask, DocumentProcessingTask } from '../models'
import { createContext, use } from 'react'

export type DocumentWriteAccess = {
  canEdit: boolean
  hasEditPermission: boolean
  permissionRecoveryBusy: boolean
  permissionRecoveryNeeded: boolean
  retryWritePermission: () => Promise<boolean>
}

export type DocumentReindexWorkflow = {
  canCancel: boolean
  cancelBusy: boolean
  disabled: boolean
  disabledReasonId?: string
  failed: boolean
  inProgress: boolean
  onCancel: () => Promise<unknown>
  onReindex: () => Promise<unknown>
  reindexing: boolean
}

export type DocumentTaskWorkflow = {
  continueLookup: () => void
  fetchNextPage: () => Promise<unknown>
  hasNextPage: boolean
  isFetchNextPageError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isLookingUp: boolean
  isPending: boolean
  latestTask?: DocumentProcessingTask
  lookupExhausted: boolean
  refetch: () => Promise<unknown>
  reindexInProgress: boolean
  tasks: BackgroundTask[]
  tasksError: unknown
}

export const DocumentWriteAccessContext = createContext<DocumentWriteAccess | null>(null)
export const DocumentReindexWorkflowContext = createContext<DocumentReindexWorkflow | null>(null)
export const DocumentTaskWorkflowContext = createContext<DocumentTaskWorkflow | null>(null)

function requiredContext<T>(context: T | null, name: string) {
  if (!context) throw new Error(`${name} must be used within DocumentDetailWorkspace`)
  return context
}

export function useDocumentWriteAccess() {
  return requiredContext(use(DocumentWriteAccessContext), 'useDocumentWriteAccess')
}

export function useDocumentReindexWorkflow() {
  return requiredContext(use(DocumentReindexWorkflowContext), 'useDocumentReindexWorkflow')
}

export function useDocumentTaskWorkflow() {
  return requiredContext(use(DocumentTaskWorkflowContext), 'useDocumentTaskWorkflow')
}
