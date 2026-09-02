import { atomWithLazy } from 'jotai/utils'
import { parseAsString } from 'nuqs'
import { createQueryAtoms } from 'nuqs-jotai'

export const retrievalKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing retrieval knowledge space id')
})

export const retrievalLocationQuery = createQueryAtoms(
  {
    research: parseAsString,
    retest: parseAsString,
    trace: parseAsString,
  },
  {
    debugLabel: 'retrieval.location',
  },
)

export const retrievalLinkedSelectionAtom = retrievalLocationQuery.atom
