'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { DocumentErrorState } from './error-state'
import { responseStatus } from './model'
import { DocumentDetailStateBoundary } from './state/boundary'
import {
  documentDetailQueryDataAtom,
  documentDetailQueryErrorAtom,
  documentDetailQueryIsPendingAtom,
  refreshDocumentDetailAtom,
} from './state/queries'
import { useDocumentDetailTitle } from './title-sync'
import { DocumentDetailWorkspace } from './workspace'

function DocumentDetailContent() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const document = useAtomValue(documentDetailQueryDataAtom)
  const documentError = useAtomValue(documentDetailQueryErrorAtom)
  const documentIsPending = useAtomValue(documentDetailQueryIsPendingAtom)
  const refreshDocument = useSetAtom(refreshDocumentDetailAtom)
  useDocumentDetailTitle()
  const documentErrorStatus = responseStatus(documentError)

  if (documentIsPending)
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

  if (!document) {
    return (
      <DocumentErrorState
        description={t(($) => $['newKnowledge.documentLoadErrorDescription'])}
        onRetry={() => void refreshDocument()}
        title={t(($) => $['newKnowledge.documentLoadErrorTitle'])}
      />
    )
  }

  return <DocumentDetailWorkspace />
}

export function DocumentDetailPage({
  documentId,
  knowledgeSpaceId,
}: {
  documentId: string
  knowledgeSpaceId: string
}) {
  return (
    <DocumentDetailStateBoundary documentId={documentId} knowledgeSpaceId={knowledgeSpaceId}>
      <DocumentDetailContent />
    </DocumentDetailStateBoundary>
  )
}
