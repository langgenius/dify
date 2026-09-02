import type { RetrievalTestMode } from '../model'
import type { RetrievalComposerImage } from './scoped'
import { atom } from 'jotai'

type RetrievalRuntimeBridge = {
  cancelResearch: (taskId: string) => void
  retry: () => Promise<void>
  run: () => void
  runFastQuery: (input?: {
    images?: RetrievalComposerImage[]
    mode: RetrievalTestMode
    query: string
  }) => void
}

const unavailableAction = () => {
  throw new Error('Retrieval runtime is unavailable')
}

export const retrievalRuntimeBridgeAtom = atom<RetrievalRuntimeBridge>({
  cancelResearch: unavailableAction,
  retry: unavailableAction,
  run: unavailableAction,
  runFastQuery: unavailableAction,
})

export const runRetrievalAtom = atom(null, (get) => get(retrievalRuntimeBridgeAtom).run())

export const retryRetrievalAtom = atom(null, async (get) => get(retrievalRuntimeBridgeAtom).retry())

export const cancelRetrievalResearchAtom = atom(null, (get, _set, taskId: string) =>
  get(retrievalRuntimeBridgeAtom).cancelResearch(taskId),
)
