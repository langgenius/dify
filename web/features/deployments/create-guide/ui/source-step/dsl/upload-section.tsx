'use client'

import { useTranslation } from 'react-i18next'
import { StepShell } from '../../shell/layout'
import { DslReadStatus } from './read-status'
import { DslUploaderField } from './uploader-field'

export function DslUploadSection() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.dsl.title')} description={t('createGuide.dsl.description')} hideHeader>
      <div className="flex flex-col gap-4 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 i-ri-upload-cloud-2-line size-5 shrink-0 text-text-tertiary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="system-sm-semibold text-text-primary">{t('createGuide.dsl.dropTitle')}</div>
            <div className="system-sm-regular text-text-tertiary">{t('createGuide.dsl.dropDescription')}</div>
          </div>
        </div>
        <DslUploaderField />
        <DslReadStatus />
      </div>
    </StepShell>
  )
}
