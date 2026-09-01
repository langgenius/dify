'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { newKnowledgeDocumentsPath } from '../../routes'
import { DocumentErrorState } from './error-state'
import { DocumentDetailHeader } from './header'
import { DocumentReindexAction } from './reindex-action'
import { DocumentRevisionBrowser } from './revision-browser'
import { documentDetailKnowledgeSpaceIdAtom } from './state/inputs'
import { documentDetailDocumentAtom } from './state/queries'
import {
  DOCUMENT_REINDEX_RESTRICTION_ID,
  documentHasEditPermissionAtom,
  documentMissingAtom,
} from './state/workflow'
import { DocumentTasksSurface } from './tasks-surface'
import { DocumentWorkflowBoundary } from './workflow-boundary'

function DocumentDetailWorkspaceContent() {
  const { t } = useTranslation('dataset')
  const document = useAtomValue(documentDetailDocumentAtom)
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const documentMissing = useAtomValue(documentMissingAtom)
  const hasEditPermission = useAtomValue(documentHasEditPermissionAtom)

  if (documentMissing)
    return (
      <DocumentErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  return (
    <section className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-5">
      <KnowledgeModelReadinessBanner
        capability="index"
        className="mb-4"
        knowledgeSpaceId={knowledgeSpaceId}
      />
      <DocumentDetailHeader
        action={<DocumentReindexAction key={document.id} />}
        backPath={newKnowledgeDocumentsPath(knowledgeSpaceId)}
        title={document.title}
      />
      {!hasEditPermission && (
        <p
          id={DOCUMENT_REINDEX_RESTRICTION_ID}
          className="mt-2 system-xs-regular text-text-warning"
        >
          {t(($) => $['newKnowledge.documentPermissionRestricted'])}
        </p>
      )}
      <DocumentTasksSurface />
      <DocumentRevisionBrowser />
    </section>
  )
}

export function DocumentDetailWorkspace() {
  return (
    <DocumentWorkflowBoundary>
      <DocumentDetailWorkspaceContent />
    </DocumentWorkflowBoundary>
  )
}
