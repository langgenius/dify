'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { BasicInformationSection } from './basic-information'
import { DeleteKnowledgeAction } from './delete-knowledge'
import { ExternalAccessSection } from './external-access'
import { RetrievalSettingsSection } from './retrieval-settings'
import { knowledgeSettingsSpaceAtom } from './state/queries'

export function KnowledgeSettingsForm() {
  const { t } = useTranslation('knowledgeSpace')
  const space = useAtomValue(knowledgeSettingsSpaceAtom)

  if (!space) return null
  const canEdit = space.permission_keys.includes('knowledge_space_edit')

  return (
    <>
      {!canEdit && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-components-panel-border bg-background-section px-3 py-2 system-xs-regular text-text-tertiary"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-2-line size-4 shrink-0" />
          {t(($) => $['settings.viewOnly'])}
        </div>
      )}

      <div className="flex flex-col gap-4 pb-7">
        <BasicInformationSection />
        <ExternalAccessSection />
        <RetrievalSettingsSection />
        <DeleteKnowledgeAction />
      </div>
    </>
  )
}
