import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { logicalDocumentFromApi } from '../../models'
import { responseStatus } from '../model'
import { documentDetailDocumentIdAtom, documentDetailKnowledgeSpaceIdAtom } from './inputs'

const documentDetailQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.get.queryOptions({
    input: {
      params: {
        control_space_id: get(documentDetailKnowledgeSpaceIdAtom),
        document_id: get(documentDetailDocumentIdAtom),
      },
    },
    retry: (failureCount, error) => {
      const status = responseStatus(error)
      return status !== 403 && status !== 404 && failureCount < 2
    },
    select: logicalDocumentFromApi,
  }),
)

export const documentDetailQueryDataAtom = selectAtom(
  documentDetailQueryAtom,
  (query) => query.data,
)
export const documentDetailQueryErrorAtom = selectAtom(
  documentDetailQueryAtom,
  (query) => query.error,
)
export const documentDetailQueryIsPendingAtom = selectAtom(
  documentDetailQueryAtom,
  (query) => query.isPending,
)

export const documentDetailDocumentAtom = atom((get) => {
  const document = get(documentDetailQueryDataAtom)
  if (!document) throw new Error('Document detail data is unavailable')
  return document
})

export const documentDetailTitleAtom = atom((get) => get(documentDetailQueryDataAtom)?.title)

export const refreshDocumentDetailAtom = atom(null, (get) => get(documentDetailQueryAtom).refetch())
