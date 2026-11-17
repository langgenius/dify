import type {
  KnowledgeFsResearchTaskPlanResponse,
  KnowledgeFsResearchTaskResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  RetrievalEvidence,
  RetrievalQueryImage,
  RetrievalTestMode,
  RetrievalTestRecord,
} from '../model'
import type { ResearchTaskProgressEvent } from '../services/research-task-events'
import { atom } from 'jotai'
import { retrievalRuntimeBridgeAtom } from './runtime'

export type RetrievalComposerImage = RetrievalQueryImage

/** Images attached in the composer, scoped like `ComposerDraft` to the record they were edited under. */
export type ComposerImagesDraft = {
  images: RetrievalComposerImage[]
  selectionKey?: string
}

export type LocalQueryRun = {
  endedAt?: number
  error?: string
  evidence: RetrievalEvidence[]
  id: string
  mode: Exclude<RetrievalTestMode, 'research'>
  query: string
  queryImages: RetrievalComposerImage[]
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

export const retrievalComposerDraftAtom = atom<ComposerDraft>({ mode: 'fast', query: '' })
export const retrievalComposerImagesAtom = atom<ComposerImagesDraft>({ images: [] })
/**
 * Query images of runs started in this session, keyed by the `${kind}:${id}` of the persisted
 * record they produced. Persisted traces do not carry their images, so this is the only source
 * that lets a record show and restore the images it was run with.
 */
export const retrievalRecordImagesAtom = atom<Record<string, RetrievalComposerImage[]>>({})
export const retrievalLocalRunAtom = atom<LocalQueryRun | undefined>()
export const retrievalLocalSelectedAtom = atom<SelectedRun | undefined>()
/**
 * The default (newest-record) selection captured when the composer is first edited without an
 * explicit selection, so history that loads or refreshes later cannot swap the unsent draft for
 * another record's query. Explicitly selecting a record clears it.
 */
export const retrievalFrozenFallbackSelectionAtom = atom<{ selected: SelectedRun | undefined }>()
export const retrievalResearchPlansAtom = atom<Record<string, KnowledgeFsResearchTaskPlanResponse>>(
  {},
)
export const retrievalResearchEventsAtom = atom<Record<string, ResearchTaskProgressEvent[]>>({})
export const retrievalAdmittedResearchTasksAtom = atom<
  Record<string, KnowledgeFsResearchTaskResponse>
>({})
export const retrievalResearchRetryPendingAtom = atom(false)
/** Whether composer images are still uploading; a run must wait for them to be attached. */
export const retrievalComposerUploadPendingAtom = atom(false)
/** History filter: every record, only console retrieval tests, or only workflow-node queries. */
export type RetrievalHistorySourceFilter = 'all' | 'retrieval_test' | 'workflow'
export const retrievalHistorySourceFilterAtom = atom<RetrievalHistorySourceFilter>('all')

export const retrievalScopedAtoms = [
  retrievalComposerDraftAtom,
  retrievalComposerImagesAtom,
  retrievalRecordImagesAtom,
  retrievalLocalRunAtom,
  retrievalLocalSelectedAtom,
  retrievalFrozenFallbackSelectionAtom,
  retrievalResearchPlansAtom,
  retrievalResearchEventsAtom,
  retrievalAdmittedResearchTasksAtom,
  retrievalResearchRetryPendingAtom,
  retrievalComposerUploadPendingAtom,
  retrievalHistorySourceFilterAtom,
  retrievalRuntimeBridgeAtom,
] as const
