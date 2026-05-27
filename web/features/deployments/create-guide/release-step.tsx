'use client'

import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'
import { StepShell } from './layout'

export function ReleaseStep({
  instanceName,
  instanceDescription,
  releaseName,
  releaseDescription,
  instanceNamePlaceholder,
  releaseNamePlaceholder,
  onInstanceNameChange,
  onInstanceDescriptionChange,
  onReleaseNameChange,
  onReleaseDescriptionChange,
}: {
  instanceName: string
  instanceDescription: string
  releaseName: string
  releaseDescription: string
  instanceNamePlaceholder: string
  releaseNamePlaceholder: string
  onInstanceNameChange: (value: string) => void
  onInstanceDescriptionChange: (value: string) => void
  onReleaseNameChange: (value: string) => void
  onReleaseDescriptionChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.release.title')}
      description={t('createGuide.release.description')}
      hideHeader
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-name">
            {t('createGuide.release.instanceName')}
          </label>
          <Input
            id="create-guide-instance-name"
            value={instanceName}
            onChange={event => onInstanceNameChange(event.target.value)}
            placeholder={instanceNamePlaceholder}
            required
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-description">
              {t('createGuide.release.instanceDescription')}
            </label>
            <span className="system-xs-regular text-text-quaternary">{t('versions.optional')}</span>
          </div>
          <textarea
            id="create-guide-instance-description"
            value={instanceDescription}
            onChange={event => onInstanceDescriptionChange(event.target.value)}
            placeholder={t('createGuide.release.instanceDescriptionPlaceholder')}
            className="min-h-16 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-name">
            {t('createGuide.release.releaseName')}
          </label>
          <Input
            id="create-guide-release-name"
            value={releaseName}
            onChange={event => onReleaseNameChange(event.target.value)}
            placeholder={releaseNamePlaceholder}
            required
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-description">
              {t('createGuide.release.releaseDescription')}
            </label>
            <span className="system-xs-regular text-text-quaternary">{t('versions.optional')}</span>
          </div>
          <textarea
            id="create-guide-release-description"
            value={releaseDescription}
            onChange={event => onReleaseDescriptionChange(event.target.value)}
            placeholder={t('createGuide.release.releaseDescriptionPlaceholder')}
            className="min-h-16 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
          />
        </div>
      </div>
    </StepShell>
  )
}
