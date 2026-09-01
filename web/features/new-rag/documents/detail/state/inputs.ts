import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'

export const documentDetailKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing document detail knowledge space id')
})

export const documentDetailDocumentIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing document detail document id')
})

export const documentDetailRequestedRevisionAtom = atom<number | null>(null)

export const documentDetailRequestedChunkIdAtom = atom<string | null>(null)
