import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'

export type RetrievalLinkedSelection = {
  research: string | null
  retest: string | null
  trace: string | null
}

export type RetrievalLocationUpdate = (
  selection: RetrievalLinkedSelection,
  options?: {
    history?: 'push' | 'replace'
    shallow?: boolean
  },
) => void

const unavailableLocationUpdate: RetrievalLocationUpdate = () => {
  throw new Error('Retrieval location bridge is unavailable')
}

export const retrievalKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing retrieval knowledge space id')
})

export const retrievalLinkedSelectionAtom = atom<RetrievalLinkedSelection>({
  research: null,
  retest: null,
  trace: null,
})

export const retrievalLocationUpdateAtom = atom<{ update: RetrievalLocationUpdate }>({
  update: unavailableLocationUpdate,
})
