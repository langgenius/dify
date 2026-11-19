'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Form } from '@langgenius/dify-ui/form'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { FileScanSetting } from '@/features/file-scan/file-scan-setting'
import { useFileScanPolicyController } from '@/features/file-scan/use-file-scan-policy'
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
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeSettings', 'knowledgeErrors'])
  const { t: tFileScan } = useTranslation(['fileScan'])
  const { t: tCommon } = useTranslation(['common'])
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const canSave = useAtomValue(knowledgeSettingsCanSubmitAtom)
  const hasDraft = useAtomValue(knowledgeSettingsHasDraftAtom)
  const hasConflict = useAtomValue(knowledgeSettingsHasConflictAtom)
  const isSaving = useAtomValue(knowledgeSettingsHasPendingSaveAtom)
  const saveError = useAtomValue(knowledgeSettingsSaveErrorAtom)
  const save = useSetAtom(saveKnowledgeSettingsAtom)
  const reset = useSetAtom(resetKnowledgeSettingsDraftAtom)
  const fileScan = useFileScanPolicyController({
    active: Boolean(space),
    product: 'knowledge-fs',
    readonly: !space?.permission_keys.includes('knowledge_space_edit'),
    resourceId: space?.control_space_id ?? '',
  })

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
    // The scan policy has its own endpoint; it goes first so a rejected policy stops the save.
    const fileScanResult = await fileScan.save()
    if (fileScanResult === 'invalid') {
      toast.error(tFileScan(($) => $['policy.scannerRequired']))
      return
    }
    if (fileScanResult === 'failed') {
      toast.error(tFileScan(($) => $['policy.saveFailed']))
      return
    }
    if (!canSave) {
      if (fileScanResult === 'saved') toast.success(tCommon(($) => $['api.actionSuccess']))
      return
    }
    const result = await save()
    if (result.status === 'saved') toast.success(tCommon(($) => $['api.actionSuccess']))
    const errorKey = result.errorKey
    if (errorKey)
      toast.error(
        errorKey === 'permissionRestricted' || errorKey === 'settings.saveFailed'
          ? t(($) => $[errorKey])
          : t(($) => $[errorKey], { ns: 'knowledgeErrors' }),
      )
  }
  const cancel = async () => {
    fileScan.reset()
    const result = await reset()
    const errorKey = result.errorKey
    if (errorKey)
      toast.error(
        errorKey === 'permissionRestricted' || errorKey === 'settings.saveFailed'
          ? t(($) => $[errorKey])
          : t(($) => $[errorKey], { ns: 'knowledgeErrors' }),
      )
  }

  return (
    <>
      {!canModify && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-components-panel-border bg-background-section px-3 py-2 system-xs-regular text-text-tertiary"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-2-line size-4 shrink-0" />
          {t(($) => $['settings.viewOnly'], { ns: 'knowledgeSpace' })}
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
          <Alert type="warning">
            <AlertTitle>
              {t(($) => $['settings.serverConflict'], { ns: 'knowledgeSettings' })}
            </AlertTitle>
            <AlertActions>
              <Button type="button" size="small" onClick={() => void cancel()}>
                {t(($) => $['settings.reloadLatest'], { ns: 'knowledgeSettings' })}
              </Button>
            </AlertActions>
          </Alert>
        )}
        <BasicInformationSection />
        <ExternalAccessSection />
        {fileScan.active && (
          <>
            <div className="h-px bg-divider-subtle" />
            <FileScanSetting controller={fileScan} />
          </>
        )}
        <RetrievalSettingsSection />
        <DeleteKnowledgeAction />
        {saveError && !isSaving && (
          <p className="system-sm-regular text-text-destructive" role="alert">
            {saveError === 'permissionRestricted' || saveError === 'settings.saveFailed'
              ? t(($) => $[saveError])
              : t(($) => $[saveError], { ns: 'knowledgeErrors' })}
          </p>
        )}
        {canSaveSettings && (
          <div className="flex justify-end gap-2 border-t border-divider-subtle pt-4">
            <Button
              type="button"
              disabled={
                (!hasDraft && !saveError && !fileScan.dirty) || isSaving || fileScan.isSaving
              }
              onClick={() => void cancel()}
            >
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSave && !fileScan.dirty && !isSaving && !fileScan.isSaving}
              loading={isSaving || fileScan.isSaving}
            >
              {t(($) => $['settings.saveChanges'], { ns: 'knowledgeSettings' })}
            </Button>
          </div>
        )}
      </Form>
    </>
  )
}
