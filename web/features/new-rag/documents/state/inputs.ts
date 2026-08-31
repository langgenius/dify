import type { DocumentFilter } from '../query-state'
import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'

export const documentsKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing documents knowledge space id')
})

export const documentFilterAtom = atom<DocumentFilter>('all')
export const documentSearchAtom = atom('')
