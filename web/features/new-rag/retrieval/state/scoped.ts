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
  retrievalRecordImagesAtom,
  retrievalLocalRunAtom,
  retrievalLocalSelectedAtom,
  retrievalResearchPlansAtom,
  retrievalResearchEventsAtom,
  retrievalAdmittedResearchTasksAtom,
  retrievalResearchRetryPendingAtom,
  retrievalRuntimeBridgeAtom,
] as const
