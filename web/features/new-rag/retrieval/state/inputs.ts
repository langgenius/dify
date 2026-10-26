import { atomWithLazy } from 'jotai/utils'
import { parseAsString } from 'nuqs'
import { createQueryGroup } from 'nuqs-jotai'

export const retrievalKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing retrieval knowledge space id')
})

export const retrievalCanQueryAtom = atomWithLazy<boolean>(() => false)

export const retrievalQueryGroup = createQueryGroup(
  {
    research: parseAsString,
    retest: parseAsString,
    trace: parseAsString,
  },
  {
    debugLabel: 'retrieval.location',
  },
)

export const retrievalLinkedSelectionAtom = retrievalQueryGroup.atom
