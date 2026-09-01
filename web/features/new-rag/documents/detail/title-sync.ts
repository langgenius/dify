'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'

export function useDocumentDetailTitle({
  documentTitle,
  knowledgeSpaceId,
}: {
  documentTitle?: string
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')
  const knowledgeSpaceQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const resolvedDocumentTitle = documentTitle ?? t(($) => $['newKnowledge.documents'])
  const knowledgeSpaceTitle =
    knowledgeSpaceQuery.data?.technical_summary?.name ?? t(($) => $.knowledge)

  useDocumentTitle(`${resolvedDocumentTitle} · ${knowledgeSpaceTitle}`)
}
