'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { logicalDocumentFromApi } from '../models'
import { DocumentErrorState } from './error-state'
import { responseStatus } from './model'
import { DocumentDetailWorkspace } from './workspace'

export function DocumentDetailPage({
  documentId,
  knowledgeSpaceId,
}: {
  documentId: string
  knowledgeSpaceId: string
}) {
  const { i18n, t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')

  const documentQueryOptions = useMemo(
    () =>
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.get.queryOptions(
        {
          input: {
            params: {
              control_space_id: knowledgeSpaceId,
              document_id: documentId,
            },
          },
          retry: (failureCount, error) => {
            const status = responseStatus(error)
            return status !== 403 && status !== 404 && failureCount < 2
          },
          select: logicalDocumentFromApi,
        },
      ),
    [documentId, knowledgeSpaceId],
  )
  const documentQuery = useQuery(documentQueryOptions)
  const knowledgeSpaceQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const documentTitle = documentQuery.data?.title ?? t(($) => $['newKnowledge.documents'])
  const knowledgeSpaceTitle =
    knowledgeSpaceQuery.data?.technical_summary?.name ?? t(($) => $.knowledge)
  useDocumentTitle(`${documentTitle} · ${knowledgeSpaceTitle}`)
  const documentErrorStatus = responseStatus(documentQuery.error)
  const locale = i18n.resolvedLanguage ?? i18n.language

  if (documentQuery.isPending)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loading />
        <span className="sr-only">{tCommon(($) => $.loading)}</span>
      </div>
    )

  if (documentErrorStatus === 403 || documentErrorStatus === 404)
    return (
      <DocumentErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  if (!documentQuery.data) {
    return (
      <DocumentErrorState
        description={t(($) => $['newKnowledge.documentLoadErrorDescription'])}
        onRetry={() => void documentQuery.refetch()}
        title={t(($) => $['newKnowledge.documentLoadErrorTitle'])}
      />
    )
  }

  return (
    <DocumentDetailWorkspace
      key={`${knowledgeSpaceId}:${documentId}`}
      document={documentQuery.data}
      documentId={documentId}
      documentQueryKey={documentQueryOptions.queryKey}
      knowledgeSpaceId={knowledgeSpaceId}
      locale={locale}
      refetchDocument={documentQuery.refetch}
    />
  )
}
