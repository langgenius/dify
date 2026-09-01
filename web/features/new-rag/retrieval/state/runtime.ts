import type { RetrievalTestMode } from '../model'
import { atom } from 'jotai'

type RetrievalRuntimeBridge = {
  cancelResearch: (taskId: string) => void
  run: () => void
  runFastQuery: (input?: { mode: RetrievalTestMode; query: string }) => void
}

const unavailableAction = () => {
  throw new Error('Retrieval runtime is unavailable')
}

export const retrievalRuntimeBridgeAtom = atom<RetrievalRuntimeBridge>({
  cancelResearch: unavailableAction,
  run: unavailableAction,
  runFastQuery: unavailableAction,
})

export const runRetrievalAtom = atom(null, (get) => get(retrievalRuntimeBridgeAtom).run())

export const retryFastRetrievalAtom = atom(null, (get) =>
  get(retrievalRuntimeBridgeAtom).runFastQuery(),
)

export const cancelRetrievalResearchAtom = atom(null, (get, _set, taskId: string) =>
  get(retrievalRuntimeBridgeAtom).cancelResearch(taskId),
)
