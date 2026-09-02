import { atomWithLazy } from 'jotai/utils'
import { createQueryAtoms } from 'nuqs-jotai'
import { documentFilterParser, documentSearchParser } from '../query-state'

export const documentsKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing documents knowledge space id')
})

export const documentsQuery = createQueryAtoms(
  {
    filter: documentFilterParser,
    search: documentSearchParser,
  },
  {
    debugLabel: 'documents.query',
    urlKeys: {
      filter: 'status',
      search: 'query',
    },
  },
)

export const { filter: documentFilterAtom, search: documentSearchAtom } = documentsQuery.atoms
