import type {
  KnowledgeFsResearchTaskPlanResponse,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RetrievalEvidence, RetrievalTestMode, RetrievalTestRecord } from '../model'
import type { ResearchTaskProgressEvent } from '../services/research-task-events'
import { atom } from 'jotai'
import { retrievalRuntimeBridgeAtom } from './runtime'

export type LocalQueryRun = {
  endedAt?: number
  error?: string
  evidence: RetrievalEvidence[]
  id: string
  mode: Exclude<RetrievalTestMode, 'research'>
  query: string
  startedAt: number
  status: 'completed' | 'failed' | 'no-results' | 'running'
  traceId?: string
}

export type SelectedRun = {
  id: string
  kind: 'local' | RetrievalTestRecord['kind']
}

export type ComposerDraft = {
  mode: RetrievalTestMode
  query: string
  selectionKey?: string
}

export type RetrievalComposerImage = {
  name: string
  previewUrl: string
  sizeBytes: number
  uploadFileId: string
}

export const retrievalComposerDraftAtom = atom<ComposerDraft>({ mode: 'fast', query: '' })
export const retrievalComposerImagesAtom = atom<RetrievalComposerImage[]>([])
export const retrievalLocalRunAtom = atom<LocalQueryRun | undefined>()
export const retrievalLocalSelectedAtom = atom<SelectedRun | undefined>()
export const retrievalResearchPlansAtom = atom<Record<string, KnowledgeFsResearchTaskPlanResponse>>(
  {},
)
export const retrievalResearchEventsAtom = atom<Record<string, ResearchTaskProgressEvent[]>>({})
export const retrievalAdmittedResearchTasksAtom = atom<
  Record<string, KnowledgeFsResearchTaskResponse>
>({})
export const retrievalResearchRetryPendingAtom = atom(false)

export const retrievalScopedAtoms = [
  retrievalComposerDraftAtom,
  retrievalComposerImagesAtom,
  retrievalLocalRunAtom,
  retrievalLocalSelectedAtom,
  retrievalResearchPlansAtom,
  retrievalResearchEventsAtom,
  retrievalAdmittedResearchTasksAtom,
  retrievalResearchRetryPendingAtom,
  retrievalRuntimeBridgeAtom,
] as const
