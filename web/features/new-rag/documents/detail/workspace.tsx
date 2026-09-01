'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelReadinessBanner } from '../../components/knowledge-model-readiness-banner'
import { newKnowledgeDocumentsPath } from '../../routes'
import { useKnowledgeSpace } from '../../space/context'
import { DocumentErrorState } from './error-state'
import { DocumentDetailHeader } from './header'
import { DocumentReindexAction } from './reindex-action'
import { DocumentRevisionBrowser } from './revision-browser'
import { documentDetailKnowledgeSpaceIdAtom } from './state/inputs'
import { documentDetailDocumentAtom } from './state/queries'
import { DOCUMENT_REINDEX_RESTRICTION_ID, documentMissingAtom } from './state/workflow'
import { DocumentTasksSurface } from './tasks-surface'
import { DocumentWorkflowController } from './workflow-controller'

export function DocumentDetailWorkspace() {
  const { t } = useTranslation('dataset')
  const { space } = useKnowledgeSpace()
  const document = useAtomValue(documentDetailDocumentAtom)
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const documentMissing = useAtomValue(documentMissingAtom)
  const hasEditPermission = space.permission_keys.includes('knowledge_space_document_write')

  if (documentMissing)
    return (
      <DocumentErrorState
        description={t(($) => $['newKnowledge.documentNotFoundDescription'])}
        title={t(($) => $['newKnowledge.documentNotFoundTitle'])}
      />
    )

  return (
    <section className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-5">
      <DocumentWorkflowController />
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
