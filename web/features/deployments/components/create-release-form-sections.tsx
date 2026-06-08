'use client'

import type { ReleaseContentMatch } from '@dify/contracts/enterprise/types.gen'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { UnsupportedDslNode } from '../error'
import type { SourceAppPickerValue } from './source-app-picker-value'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { SourceAppPicker } from './source-app-picker'
import { UnsupportedDslNodesAlert } from './unsupported-dsl-nodes-alert'

export type ReleaseSourceMode = 'sourceApp' | 'dsl'

const DESCRIPTION_MAX_LENGTH = 512
const DESCRIPTION_WARN_THRESHOLD = 460

function selectedReleaseSourceMode(value: readonly ReleaseSourceMode[] | undefined) {
  return value?.[0]
}

function releaseContentMatchLabel(release?: ReleaseContentMatch) {
  return release?.name || release?.releaseId || '—'
}

export function ReleaseSourceSection({
  releaseSourceMode,
  selectedSourceApp,
  dslFile,
  isReadingDsl,
  dslReadError,
  hasUnsupportedDslMode,
  onReleaseSourceModeChange,
  onSourceAppChange,
  onDslFileChange,
}: {
  releaseSourceMode: ReleaseSourceMode
  selectedSourceApp?: SourceAppPickerValue
  dslFile?: File
  isReadingDsl: boolean
  dslReadError: boolean
  hasUnsupportedDslMode: boolean
  onReleaseSourceModeChange: (nextMode: ReleaseSourceMode) => void
  onSourceAppChange: (app: App) => void
  onDslFileChange: (file?: File) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label id="release-source-mode-label" className="system-xs-medium-uppercase text-text-tertiary">
          {t('versions.releaseSourceLabel')}
        </label>
        <SegmentedControl<ReleaseSourceMode>
          aria-labelledby="release-source-mode-label"
          value={[releaseSourceMode]}
          onValueChange={(value) => {
            const nextMode = selectedReleaseSourceMode(value)
            if (nextMode)
              onReleaseSourceModeChange(nextMode)
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
      </div>

      <div className="min-h-12">
        {releaseSourceMode === 'sourceApp'
          ? (
              <div className="flex min-h-12 items-center">
                <SourceAppPicker
                  value={selectedSourceApp}
                  onChange={onSourceAppChange}
                  ariaLabel={t('versions.sourceAppOption')}
                />
              </div>
            )
          : (
              <div className="flex min-h-12 flex-col gap-2">
                <Uploader
                  file={dslFile}
                  updateFile={onDslFileChange}
                  className="mt-0"
                />
                {isReadingDsl && (
                  <div className="system-xs-regular text-text-tertiary">
                    {t('versions.dslReading')}
                  </div>
                )}
                {dslReadError && (
                  <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
                    {t('versions.dslReadFailed')}
                  </div>
                )}
                {hasUnsupportedDslMode && (
                  <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
                    {t('versions.dslUnsupportedMode')}
                  </div>
                )}
              </div>
            )}
      </div>
    </div>
  )
}

export function ReleaseContentFeedback({
  unsupportedDslNodes,
  isCheckingReleaseContent,
  matchedRelease,
  releaseContentCheckFailed,
}: {
  unsupportedDslNodes: UnsupportedDslNode[]
  isCheckingReleaseContent: boolean
  matchedRelease?: ReleaseContentMatch
  releaseContentCheckFailed: boolean
}) {
  const { t } = useTranslation('deployments')

  return (
    <>
      <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />

      {isCheckingReleaseContent && (
        <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-2 system-sm-regular text-text-tertiary">
          {t('versions.checkingReleaseContent')}
        </div>
      )}

      {matchedRelease && (
        <div role="alert" className="rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-3 py-2 system-sm-regular text-util-colors-warning-warning-700">
          {t('versions.releaseAlreadyExists', { name: releaseContentMatchLabel(matchedRelease) })}
        </div>
      )}

      {releaseContentCheckFailed && (
        <div role="alert" className="rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 px-3 py-2 system-sm-regular text-util-colors-red-red-700">
          {t('versions.releaseContentCheckFailed')}
        </div>
      )}
    </>
  )
}

export function ReleaseMetadataFields({
  releaseName,
  releaseNameRequired,
  releaseDescription,
  onReleaseNameBlur,
  onReleaseNameChange,
  onReleaseDescriptionChange,
}: {
  releaseName: string
  releaseNameRequired: boolean
  releaseDescription: string
  onReleaseNameBlur: () => void
  onReleaseNameChange: (value: string) => void
  onReleaseDescriptionChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const descriptionLength = releaseDescription.length
  const isNearLimit = descriptionLength >= DESCRIPTION_WARN_THRESHOLD

  return (
    <>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-name">
          {t('versions.releaseNameLabel')}
        </label>
        <Input
          id="release-name"
          name="releaseName"
          placeholder={t('versions.releaseNamePlaceholder')}
          maxLength={128}
          autoComplete="off"
          value={releaseName}
          aria-invalid={releaseNameRequired || undefined}
          aria-describedby={releaseNameRequired ? 'release-name-error' : undefined}
          onBlur={onReleaseNameBlur}
          onChange={event => onReleaseNameChange(event.target.value)}
          autoFocus
          className="h-9"
        />
        {releaseNameRequired && (
          <div id="release-name-error" role="alert" className="system-xs-regular text-text-destructive">
            {t('versions.releaseNameRequired')}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-description">
            {t('versions.releaseDescriptionLabel')}
          </label>
          <div className="flex items-center gap-2">
            <span className="system-xs-regular text-text-quaternary">
              {t('versions.optional')}
            </span>
            <span
              className={cn(
                'system-xs-regular tabular-nums',
                isNearLimit ? 'text-util-colors-warning-warning-700' : 'text-text-quaternary',
              )}
            >
              {descriptionLength}
              /
              {DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
        </div>
        <Textarea
          id="release-description"
          name="releaseDescription"
          placeholder={t('versions.releaseDescriptionPlaceholder')}
          maxLength={DESCRIPTION_MAX_LENGTH}
          autoComplete="off"
          value={releaseDescription}
          onValueChange={onReleaseDescriptionChange}
          className="min-h-24 resize-none"
        />
      </div>
    </>
  )
}

export function CreateReleaseActions({
  isCreatePending,
  isCheckingReleaseContent,
  canCreate,
  onCancelPointerDown,
  onCancelClick,
}: {
  isCreatePending: boolean
  isCheckingReleaseContent: boolean
  canCreate: boolean
  onCancelPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onCancelClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex items-center justify-end gap-4 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
      <div className="flex shrink-0 justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={isCreatePending || isCheckingReleaseContent}
          onPointerDown={onCancelPointerDown}
          onClick={onCancelClick}
        >
          {t('versions.cancelCreate')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="min-w-22"
          disabled={!canCreate}
        >
          {isCreatePending ? t('versions.creating') : isCheckingReleaseContent ? t('versions.checkingReleaseContent') : t('versions.create')}
        </Button>
      </div>
    </div>
  )
}
