'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Form } from '@langgenius/dify-ui/form'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { KnowledgeModelReadinessNotice } from '../components/knowledge-model-readiness-notice'
import { BasicInformationSection } from './basic-information'
import { DeleteKnowledgeAction } from './delete-knowledge'
import { ExternalAccessSection } from './external-access'
import { RetrievalSettingsSection } from './retrieval-settings'
import { knowledgeSettingsHasConflictAtom, knowledgeSettingsHasDraftAtom } from './state/draft'
import { knowledgeSettingsSpaceAtom } from './state/queries'
import {
  knowledgeSettingsCanSubmitAtom,
  knowledgeSettingsHasPendingSaveAtom,
  knowledgeSettingsSaveErrorAtom,
  resetKnowledgeSettingsDraftAtom,
  saveKnowledgeSettingsAtom,
} from './state/workflow'

export function KnowledgeSettingsForm() {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const canSave = useAtomValue(knowledgeSettingsCanSubmitAtom)
  const hasDraft = useAtomValue(knowledgeSettingsHasDraftAtom)
  const hasConflict = useAtomValue(knowledgeSettingsHasConflictAtom)
  const isSaving = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
  const saveError = useAtomValue(knowledgeSettingsSaveErrorAtom)
  const save = useSetAtom(saveKnowledgeSettingsAtom)
  const reset = useSetAtom(resetKnowledgeSettingsDraftAtom)

  if (!space) return null
  const canModify = space.permission_keys.some((permission) =>
    ['knowledge_space_access_config', 'knowledge_space_delete', 'knowledge_space_edit'].includes(
      permission,
    ),
  )
  const canSaveSettings = space.permission_keys.some((permission) =>
    ['knowledge_space_access_config', 'knowledge_space_edit'].includes(permission),
  )

  const submit = async () => {
    const result = await save()
    if (result.status === 'saved') toast.success(tCommon(($) => $['api.actionSuccess']))
    const errorKey = result.errorKey
    if (errorKey) toast.error(t(($) => $[errorKey]))
  }
  const cancel = async () => {
    const result = await reset()
    const errorKey = result.errorKey
    if (errorKey) toast.error(t(($) => $[errorKey]))
  }

  return (
    <>
      {!canModify && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-components-panel-border bg-background-section px-3 py-2 system-xs-regular text-text-tertiary"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-2-line size-4 shrink-0" />
          {t(($) => $['settings.viewOnly'])}
        </div>
      )}

      <Form
        className="flex flex-col gap-4 pb-7"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {(hasConflict || saveError === 'settings.revisionConflict') && !isSaving && (
          <KnowledgeModelReadinessNotice
            title={t(($) => $['settings.serverConflict'])}
            tone="warning"
            action={
              <Button type="button" onClick={() => void cancel()}>
                {t(($) => $['settings.reloadLatest'])}
              </Button>
            }
          />
        )}
        <BasicInformationSection />
        <ExternalAccessSection />
        <RetrievalSettingsSection />
        <DeleteKnowledgeAction />
        {saveError && !isSaving && (
          <p className="system-sm-regular text-text-destructive" role="alert">
            {t(($) => $[saveError])}
          </p>
        )}
        {canSaveSettings && (
          <div className="flex justify-end gap-2 border-t border-divider-subtle pt-4">
            <Button
              type="button"
              disabled={(!hasDraft && !saveError) || isSaving}
              onClick={() => void cancel()}
            >
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSave && !isSaving}
              loading={isSaving}
            >
              {t(($) => $['settings.saveChanges'])}
            </Button>
          </div>
        )}
      </Form>
    </>
  )
}
