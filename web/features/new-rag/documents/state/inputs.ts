import type { KnowledgeSpaceContextValue } from '../../space/context'
import { atomWithLazy } from 'jotai/utils'
import { atomsWithSearchParams } from 'nuqs-jotai'
import {
  documentFilterParser,
  documentMetadataParser,
  documentSearchParser,
  documentUploadParser,
} from '../query-state'

export const documentsKnowledgeSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing documents knowledge space id')
})

export const {
  filter: documentFilterAtom,
  search: documentSearchAtom,
  upload: documentUploadAtom,
  metadata: documentMetadataAtom,
} = atomsWithSearchParams(
  {
    filter: documentFilterParser,
    search: documentSearchParser,
    upload: documentUploadParser,
    metadata: documentMetadataParser,
  },
  {
    debugLabel: 'documents.query',
    urlKeys: {
      filter: 'status',
      search: 'query',
    },
  },
)

export const documentsSpaceContextAtom = atomWithLazy<KnowledgeSpaceContextValue>(() => {
  throw new Error('Missing documents knowledge space context')
})

export const documentsDownloadPermissionAtom = atomWithLazy<boolean>(() => {
  throw new Error('Missing documents download permission')
})
