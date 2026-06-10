'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import {
  createDslState,
} from '../../models/selectors'
import {
  dslContentAtom,
  dslFileAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
  selectDslFileAtom,
} from '../../state/dsl-atoms'
import {
  methodAtom,
} from '../../state/workflow-atoms'
import { StepShell } from '../shell/layout'

export function DslUploadSection() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const dslFile = useAtomValue(dslFileAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const selectDslFile = useSetAtom(selectDslFileAtom)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })

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
          updateFile={selectDslFile}
        />
        {isReadingDsl && (
          <div className="system-xs-regular text-text-tertiary">
            {t('createGuide.dsl.reading')}
          </div>
        )}
        {dslReadError && (
          <div className="system-xs-regular text-text-destructive">
            {t('createGuide.dsl.readFailed')}
          </div>
        )}
        {dslState.dslUnsupportedMode && (
          <div role="alert" className="system-xs-regular text-text-destructive">
            {t('createGuide.dsl.unsupportedMode')}
          </div>
        )}
      </div>
    </StepShell>
  )
}
