'use client'

import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

function readinessTitle(
  readiness: KnowledgeFsSettingsResponse | undefined,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
  tCommon: ReturnType<typeof useTranslation<'common'>>['t'],
) {
  if (readiness?.configuration_state === 'pending-validation')
    return tCommon(($) => $['provider.validating'])
  if (readiness?.configuration_state === 'validation-failed')
    return tCommon(($) => $['api.actionFailed'])
  return t(($) => $['newKnowledge.overview.attention.modelReadiness.title'])
}

export function KnowledgeModelSetupDialog({
  onConfigure,
  onOpenChange,
  open,
  readiness,
}: {
  onConfigure: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  readiness?: KnowledgeFsSettingsResponse
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')

  const fieldLabel = (field: KnowledgeFsSettingsResponse['issues'][number]['field']) => {
    if (field === 'embedding') return tSettings(($) => $['form.embeddingModel'])
    if (field === 'reasoning') return tCommon(($) => $['modelProvider.systemReasoningModel.key'])
    if (field === 'rerank') return tCommon(($) => $['modelProvider.rerankModel.key'])
    return t(($) => $['newKnowledge.overview.attention.modelReadiness.bindingMissing'])
  }
  const pendingValidation = readiness?.configuration_state === 'pending-validation'
  const description = pendingValidation
    ? undefined
    : readiness?.active_profile_available
      ? t(($) => $['newKnowledge.overview.attention.modelReadiness.description'])
      : t(($) => $['newKnowledge.overview.attention.modelReadiness.profilesMissing'])
  const issues = readiness
    ? readiness.issues
    : ([{ field: 'reasoning' }, { field: 'embedding' }, { field: 'rerank' }] as const)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-120 p-0!">
        <div className="px-6 pt-6">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {readinessTitle(readiness, t, tCommon)}
          </DialogTitle>
          {description && (
            <DialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {description}
            </DialogDescription>
          )}
          {issues.length > 0 && (
            <ul className="mt-3 space-y-1 body-sm-regular text-text-secondary">
              {issues.map((issue) => (
                <li key={issue.field} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 i-ri-error-warning-line size-4 shrink-0" />
                  {fieldLabel(issue.field)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2 px-6 pb-6">
          <Button onClick={() => onOpenChange(false)}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button variant="primary" onClick={onConfigure}>
            {tCommon(($) => $['modelProvider.selector.configure'])}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
