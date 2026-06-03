'use client'

import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { StepShell } from './layout'

export function DslStep({
  dslFile,
  isReadingDsl,
  readError,
  unsupportedMode,
  onDslFileChange,
}: {
  dslFile?: File
  isReadingDsl: boolean
  readError: boolean
  unsupportedMode: boolean
  onDslFileChange: (file?: File) => void
}) {
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
        <Uploader
          className="mt-0"
          file={dslFile}
          updateFile={onDslFileChange}
        />
        {isReadingDsl && (
          <div className="system-xs-regular text-text-tertiary">
            {t('createGuide.dsl.reading')}
          </div>
        )}
        {readError && (
          <div className="system-xs-regular text-text-destructive">
            {t('createGuide.dsl.readFailed')}
          </div>
        )}
        {unsupportedMode && (
          <div role="alert" className="system-xs-regular text-text-destructive">
            {t('createGuide.dsl.unsupportedMode')}
          </div>
        )}
      </div>
    </StepShell>
  )
}
