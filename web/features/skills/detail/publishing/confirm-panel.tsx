'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { SkillReferencesPanel } from '../../references'
import { SkillPublishShortcut } from './bar'

export function SkillPublishConfirmPanel({
  loading,
  onCancel,
  onConfirm,
  open,
  referenceCount,
  skillId,
}: {
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  referenceCount: number
  skillId: string
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-labelledby="skill-publish-confirm-title"
      data-open
      className="pointer-events-auto relative flex w-96 max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl bg-components-panel-bg-blur shadow-lg inset-ring-[0.5px] shadow-shadow-shadow-5 inset-ring-components-panel-border backdrop-blur-[5px]"
    >
      <div className="px-3 pt-3.5 pb-1">
        <h2
          id="skill-publish-confirm-title"
          className="px-1 pe-8 system-xl-semibold text-text-primary"
        >
          {t(($) => $['skillManagement.detail.publishReferencesTitle'])}
        </h2>
        <p className="mt-0.5 px-1 system-xs-regular text-util-colors-warning-warning-600">
          {t(($) => $['skillManagement.detail.publishReferencesDescription'], {
            count: referenceCount,
          })}
        </p>
      </div>
      <div className="px-4 py-2">
        <SkillReferencesPanel
          compact
          enabled={open}
          maxHeight="max-h-[240px]"
          skillId={skillId}
          testId="skill-publish-reference-list"
          visibleLimit={5}
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-4 pt-2 pb-4">
        <Button className="h-8 min-w-18 rounded-lg px-3" disabled={loading} onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          className="h-8 gap-1 rounded-lg px-3"
          variant="primary"
          loading={loading}
          onClick={onConfirm}
        >
          <span>{t(($) => $['skillManagement.detail.publishUpdate'])}</span>
          <SkillPublishShortcut />
        </Button>
      </div>
    </div>
  )
}
