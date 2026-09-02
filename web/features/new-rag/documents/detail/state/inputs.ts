import { atomWithLazy } from 'jotai/utils'
import { documentDetailLocationQuery } from './location'

export const documentDetailKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing document detail knowledge space id')
})

export const documentDetailDocumentIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing document detail document id')
})

export const {
  chunk: documentDetailRequestedChunkIdAtom,
  revision: documentDetailRequestedRevisionAtom,
} = documentDetailLocationQuery.atoms
