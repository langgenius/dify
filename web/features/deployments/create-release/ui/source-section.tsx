'use client'

import type { ReleaseSourceMode } from '../state'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { isDeploymentDslImportEnabled } from '../../shared/domain/feature-flags'
import {
  createReleaseDslFileFieldAtom,
  createReleaseDslReadErrorAtom,
  createReleaseHasUnsupportedDslModeAtom,
  createReleaseSelectedSourceAppAtom,
  createReleaseSourceModeAtom,
  isReadingCreateReleaseDslAtom,
  selectCreateReleaseSourceModeAtom,
  updateCreateReleaseDslFileAtom,
  updateCreateReleaseSourceAppAtom,
} from '../state'
import { SourceAppPicker } from './source-app-picker'

function selectedReleaseSourceMode(value: readonly ReleaseSourceMode[] | undefined) {
  return value?.[0]
}

export function ReleaseSourceSection() {
  const { t } = useTranslation('deployments')
  const releaseSourceMode = useAtomValue(createReleaseSourceModeAtom)
  const selectReleaseSourceMode = useSetAtom(selectCreateReleaseSourceModeAtom)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          id="release-source-mode-label"
          className="system-xs-medium-uppercase text-text-tertiary"
        >
          {t(($) => $['versions.releaseSourceLabel'])}
        </label>
        {isDeploymentDslImportEnabled && (
          <SegmentedControl<ReleaseSourceMode>
            aria-labelledby="release-source-mode-label"
            value={[releaseSourceMode]}
            onValueChange={(value) => {
              const nextMode = selectedReleaseSourceMode(value)
              if (!nextMode || nextMode === releaseSourceMode) return

              selectReleaseSourceMode(nextMode)
            }}
            className="shrink-0"
          >
            <SegmentedControlItem value="sourceApp" className="gap-1.5">
              <span className="i-ri-apps-2-line size-4 shrink-0" aria-hidden="true" />
              <span>{t(($) => $['versions.sourceAppOption'])}</span>
            </SegmentedControlItem>
            <SegmentedControlItem value="dsl" className="gap-1.5">
              <span className="i-ri-upload-cloud-2-line size-4 shrink-0" aria-hidden="true" />
              <span>{t(($) => $['versions.manualDslOption'])}</span>
            </SegmentedControlItem>
          </SegmentedControl>
        )}
      </div>

      <div className="min-h-12">
        {releaseSourceMode === 'sourceApp' ? <SourceAppField /> : <DslFileField />}
      </div>
    </div>
  )
}

function SourceAppField() {
  const sourceApp = useAtomValue(createReleaseSelectedSourceAppAtom)
  const updateSourceApp = useSetAtom(updateCreateReleaseSourceAppAtom)
  const sourceAppLocked = !isDeploymentDslImportEnabled

  return (
    <div className="flex min-h-12 items-center">
      <SourceAppPicker value={sourceApp} onChange={updateSourceApp} disabled={sourceAppLocked} />
    </div>
  )
}

function DslFileField() {
  const { t } = useTranslation('deployments')
  const dslFileField = useAtomValue(createReleaseDslFileFieldAtom)
  const isReadingDsl = useAtomValue(isReadingCreateReleaseDslAtom)
  const dslReadError = useAtomValue(createReleaseDslReadErrorAtom)
  const updateDslFile = useSetAtom(updateCreateReleaseDslFileAtom)

  return (
    <div className="flex min-h-12 flex-col gap-2">
      <Uploader
        file={dslFileField.value}
        updateFile={(file) => {
          void updateDslFile(file)
        }}
        className="mt-0"
      />
      {isReadingDsl && (
        <div role="status" className="system-xs-regular text-text-tertiary">
          {t(($) => $['versions.dslReading'])}
        </div>
      )}
      {dslReadError && (
        <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
          {t(($) => $['versions.dslReadFailed'])}
        </div>
      )}
      <DslUnsupportedModeError />
    </div>
  )
}

function DslUnsupportedModeError() {
  const { t } = useTranslation('deployments')
  const hasUnsupportedDslMode = useAtomValue(createReleaseHasUnsupportedDslModeAtom)

  if (!hasUnsupportedDslMode) return null

  return (
    <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
      {t(($) => $['versions.dslUnsupportedMode'])}
    </div>
  )
}
