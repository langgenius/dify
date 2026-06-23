'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createReleaseDescriptionFieldAtom,
  createReleaseNameFieldAtom,
  RELEASE_NAME_REQUIRED_ERROR,
} from '../state'

const DESCRIPTION_MAX_LENGTH = 512
const DESCRIPTION_WARN_THRESHOLD = 460

function isValidationIssue(error: unknown): error is { message: string } {
  return Boolean(
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string',
  )
}

function hasReleaseNameRequiredError(errors: unknown[]) {
  return errors.some((error) => {
    if (error === RELEASE_NAME_REQUIRED_ERROR)
      return true

    if (Array.isArray(error))
      return error.some(issue => isValidationIssue(issue) && issue.message === RELEASE_NAME_REQUIRED_ERROR)

    return isValidationIssue(error) && error.message === RELEASE_NAME_REQUIRED_ERROR
  })
}

export function ReleaseMetadataFields() {
  const { t } = useTranslation('deployments')
  const [releaseNameField, setReleaseNameField] = useAtom(createReleaseNameFieldAtom)
  const [releaseDescriptionField, setReleaseDescriptionField] = useAtom(createReleaseDescriptionFieldAtom)
  const releaseNameInputRef = useRef<HTMLInputElement>(null)
  const releaseNameErrors = releaseNameField.meta?.errors ?? []

  useEffect(() => {
    releaseNameInputRef.current?.focus()
  }, [])

  return (
    <>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-name">
          {t('versions.releaseNameLabel')}
        </label>
        <Input
          ref={releaseNameInputRef}
          id="release-name"
          name="releaseName"
          placeholder={t('versions.releaseNamePlaceholder')}
          maxLength={128}
          autoComplete="off"
          value={releaseNameField.value}
          aria-invalid={hasReleaseNameRequiredError(releaseNameErrors) || undefined}
          aria-describedby={hasReleaseNameRequiredError(releaseNameErrors) ? 'release-name-error' : undefined}
          onChange={(event) => {
            setReleaseNameField(event.target.value)
          }}
          className="h-9"
        />
        {hasReleaseNameRequiredError(releaseNameErrors) && (
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
                releaseDescriptionField.value.length >= DESCRIPTION_WARN_THRESHOLD ? 'text-util-colors-warning-warning-700' : 'text-text-quaternary',
              )}
            >
              {releaseDescriptionField.value.length}
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
          value={releaseDescriptionField.value}
          onValueChange={(value) => {
            setReleaseDescriptionField(value)
          }}
          className="min-h-24 resize-none"
        />
      </div>
    </>
  )
}
