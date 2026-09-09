import { atomWithLazy } from 'jotai/utils'
import { parseAsString } from 'nuqs'
import { atomWithSearchParams } from 'nuqs-jotai'

export const retrievalKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing retrieval knowledge space id')
})

export const retrievalCanQueryAtom = atomWithLazy<boolean>(() => false)

export const retrievalLinkedSelectionAtom = atomWithSearchParams(
  {
    research: parseAsString,
    retest: parseAsString,
    trace: parseAsString,
  },
  {
    debugLabel: 'retrieval.location',
  },
)
