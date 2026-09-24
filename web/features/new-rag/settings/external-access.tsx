'use client'

import { Switch } from '@langgenius/dify-ui/switch'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SettingsFieldRow } from './settings-field-row'
import {
  knowledgeSettingsExternalDraftAtom,
  updateKnowledgeSettingsExternalDraftAtom,
} from './state/draft'
import { knowledgeSettingsSpaceAtom } from './state/queries'
import { knowledgeSettingsInteractionLockedAtom } from './state/workflow'

const API_ACCESS_DESCRIPTION_ID = 'knowledge-api-access-description'
const WORKFLOW_ACCESS_DESCRIPTION_ID = 'knowledge-workflow-access-description'

export function ExternalAccessSection() {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeSettings'])
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const current = useAtomValue(knowledgeSettingsExternalDraftAtom)
  const updateDraft = useSetAtom(updateKnowledgeSettingsExternalDraftAtom)
  const interactionLocked = useAtomValue(knowledgeSettingsInteractionLockedAtom)

  if (!space || !current) return null
  const canManageAccess = space.permission_keys.includes('knowledge_space_access_config')
  const disabled = !canManageAccess || interactionLocked

  return (
    <div className="flex flex-col gap-4">
      <div className="h-px bg-divider-subtle" />
      <SettingsFieldRow label={t(($) => $['settings.apiAccessLabel'], { ns: 'knowledgeSettings' })}>
        <div className="flex min-h-7 items-center gap-2">
          <Switch
            aria-label={t(($) => $.apiAgentAccess)}
            aria-describedby={API_ACCESS_DESCRIPTION_ID}
            checked={current.apiEnabled}
            disabled={disabled}
            onCheckedChange={(apiEnabled) => !disabled && updateDraft({ apiEnabled })}
          />
          <p
            id={API_ACCESS_DESCRIPTION_ID}
            className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
          >
            {t(($) => $['settings.apiAccessDescription'], { ns: 'knowledgeSettings' })}
          </p>
        </div>
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t(($) => $['settings.workflowAccessLabel'], { ns: 'knowledgeSettings' })}
      >
        <div className="flex min-h-7 items-center gap-2">
          <Switch
            aria-label={t(($) => $.workflowAccess, { ns: 'knowledgeSettings' })}
            aria-describedby={WORKFLOW_ACCESS_DESCRIPTION_ID}
            checked={current.workflowEnabled}
            disabled={disabled}
            onCheckedChange={(workflowEnabled) => !disabled && updateDraft({ workflowEnabled })}
          />
          <p
            id={WORKFLOW_ACCESS_DESCRIPTION_ID}
            className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
          >
            {t(($) => $['settings.workflowAccessDescription'], { ns: 'knowledgeSettings' })}
          </p>
        </div>
      </SettingsFieldRow>
    </div>
  )
}
