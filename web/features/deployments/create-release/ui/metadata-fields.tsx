'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateReleaseFormApi } from '../state'
import {
  RELEASE_NAME_REQUIRED_ERROR,
  validateReleaseName,
} from '../state/use-create-release-form'

const DESCRIPTION_MAX_LENGTH = 512
const DESCRIPTION_WARN_THRESHOLD = 460

function hasReleaseNameRequiredError(errors: unknown[]) {
  return errors.includes(RELEASE_NAME_REQUIRED_ERROR)
}

export function ReleaseMetadataFields() {
  const { t } = useTranslation('deployments')
  const form = useCreateReleaseFormApi()
  const releaseNameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    releaseNameInputRef.current?.focus()
  }, [])

  return (
    <>
      <form.Field
        name="releaseName"
        validators={{
          onBlur: validateReleaseName,
          onChange: validateReleaseName,
          onSubmit: validateReleaseName,
        }}
      >
        {field => (
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
              value={field.state.value}
              aria-invalid={hasReleaseNameRequiredError(field.state.meta.errors) || undefined}
              aria-describedby={hasReleaseNameRequiredError(field.state.meta.errors) ? 'release-name-error' : undefined}
              onBlur={field.handleBlur}
              onChange={event => field.handleChange(event.target.value)}
              className="h-9"
            />
            {hasReleaseNameRequiredError(field.state.meta.errors) && (
              <div id="release-name-error" role="alert" className="system-xs-regular text-text-destructive">
                {t('versions.releaseNameRequired')}
              </div>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="releaseDescription">
        {field => (
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
                    field.state.value.length >= DESCRIPTION_WARN_THRESHOLD ? 'text-util-colors-warning-warning-700' : 'text-text-quaternary',
                  )}
                >
                  {field.state.value.length}
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
              value={field.state.value}
              onValueChange={field.handleChange}
              className="min-h-24 resize-none"
            />
          </div>
        )}
      </form.Field>
    </>
  )
}
