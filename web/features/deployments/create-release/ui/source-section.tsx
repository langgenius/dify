'use client'

import type { ReleaseSourceMode } from '../state/types'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { isDeploymentDslImportEnabled } from '../../shared/domain/feature-flags'
import {
  clearCreateReleaseSubmissionErrorAtom,
  createReleaseDslStateAtom,
  resetCreateReleaseDslFileAtom,
  selectCreateReleaseDslFileAtom,
  useCreateReleaseFormApi,
} from '../state'
import { SourceAppPicker } from './source-app-picker'

function selectedReleaseSourceMode(value: readonly ReleaseSourceMode[] | undefined) {
  return value?.[0]
}

export function ReleaseSourceSection() {
  const { t } = useTranslation('deployments')
  const form = useCreateReleaseFormApi()
  const resetDslFile = useSetAtom(resetCreateReleaseDslFileAtom)
  const clearSubmissionError = useSetAtom(clearCreateReleaseSubmissionErrorAtom)

  return (
    <form.Field name="releaseSourceMode">
      {modeField => (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label id="release-source-mode-label" className="system-xs-medium-uppercase text-text-tertiary">
              {t('versions.releaseSourceLabel')}
            </label>
            {isDeploymentDslImportEnabled && (
              <SegmentedControl<ReleaseSourceMode>
                aria-labelledby="release-source-mode-label"
                value={[modeField.state.value]}
                onValueChange={(value) => {
                  const nextMode = selectedReleaseSourceMode(value)
                  if (!nextMode || nextMode === modeField.state.value)
                    return

                  clearSubmissionError()
                  modeField.handleChange(nextMode)
                  if (nextMode === 'sourceApp') {
                    form.setFieldValue('dslFile', undefined)
                    resetDslFile()
                  }
                  else {
                    form.setFieldValue('sourceApp', undefined)
                  }
                }}
                className="shrink-0"
              >
                <SegmentedControlItem value="sourceApp" className="gap-1.5">
                  <span className="i-ri-apps-2-line size-4 shrink-0" aria-hidden="true" />
                  <span>{t('versions.sourceAppOption')}</span>
                </SegmentedControlItem>
                <SegmentedControlItem value="dsl" className="gap-1.5">
                  <span className="i-ri-upload-cloud-2-line size-4 shrink-0" aria-hidden="true" />
                  <span>{t('versions.manualDslOption')}</span>
                </SegmentedControlItem>
              </SegmentedControl>
            )}
          </div>

          <div className="min-h-12">
            {modeField.state.value === 'sourceApp' || !isDeploymentDslImportEnabled
              ? <SourceAppField />
              : <DslFileField />}
          </div>
        </div>
      )}
    </form.Field>
  )
}

function SourceAppField() {
  const { t } = useTranslation('deployments')
  const form = useCreateReleaseFormApi()
  const clearSubmissionError = useSetAtom(clearCreateReleaseSubmissionErrorAtom)
  const sourceAppLocked = !isDeploymentDslImportEnabled

  return (
    <form.Field name="sourceApp">
      {field => (
        <div className="flex min-h-12 items-center">
          <SourceAppPicker
            value={field.state.value}
            onChange={(app) => {
              field.handleChange(app)
              clearSubmissionError()
            }}
            ariaLabel={t('versions.sourceAppOption')}
            disabled={sourceAppLocked}
          />
        </div>
      )}
    </form.Field>
  )
}

function DslFileField() {
  const { t } = useTranslation('deployments')
  const form = useCreateReleaseFormApi()
  const dslState = useAtomValue(createReleaseDslStateAtom)
  const clearSubmissionError = useSetAtom(clearCreateReleaseSubmissionErrorAtom)
  const selectDslFile = useSetAtom(selectCreateReleaseDslFileAtom)

  return (
    <form.Field name="dslFile">
      {field => (
        <div className="flex min-h-12 flex-col gap-2">
          <Uploader
            file={field.state.value}
            updateFile={(file) => {
              field.handleChange(file)
              clearSubmissionError()
              void selectDslFile(file)
            }}
            className="mt-0"
          />
          {dslState.isReadingDsl && (
            <div className="system-xs-regular text-text-tertiary">
              {t('versions.dslReading')}
            </div>
          )}
          {dslState.dslReadError && (
            <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
              {t('versions.dslReadFailed')}
            </div>
          )}
          <DslUnsupportedModeError />
        </div>
      )}
    </form.Field>
  )
}

function DslUnsupportedModeError() {
  const { t } = useTranslation('deployments')
  const dslState = useAtomValue(createReleaseDslStateAtom)
  const hasUnsupportedDslMode = dslState.hasDslContent
    && !dslState.isReadingDsl
    && !dslState.dslReadError
    && !dslState.isWorkflowDslContent

  if (!hasUnsupportedDslMode)
    return null

  return (
    <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
      {t('versions.dslUnsupportedMode')}
    </div>
  )
}
