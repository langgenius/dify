'use client'

import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useReleaseStepFields } from '../../models/release'
import {
  instanceDescriptionAtom,
  instanceNameAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
  setInstanceDescriptionAtom,
  setInstanceNameAtom,
  setReleaseDescriptionAtom,
  setReleaseNameAtom,
} from '../../state/release-atoms'
import { StepShell } from '../shell/layout'

export function ReleaseStepContent() {
  const { t } = useTranslation('deployments')
  const instanceName = useAtomValue(instanceNameAtom)
  const instanceDescription = useAtomValue(instanceDescriptionAtom)
  const releaseName = useAtomValue(releaseNameAtom)
  const releaseDescription = useAtomValue(releaseDescriptionAtom)
  const setInstanceName = useSetAtom(setInstanceNameAtom)
  const setInstanceDescription = useSetAtom(setInstanceDescriptionAtom)
  const setReleaseName = useSetAtom(setReleaseNameAtom)
  const setReleaseDescription = useSetAtom(setReleaseDescriptionAtom)
  const releaseStep = useReleaseStepFields()
  const instanceNameErrorId = 'create-guide-instance-name-error'

  return (
    <StepShell
      title={t('createGuide.release.title')}
      description={t('createGuide.release.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h3 className="system-sm-semibold text-text-primary">
            {t('createGuide.release.deployInfo')}
          </h3>
          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-name">
              {t('createGuide.release.instanceName')}
            </label>
            <Input
              id="create-guide-instance-name"
              value={instanceName}
              onChange={event => setInstanceName(event.target.value)}
              placeholder={releaseStep.sourceName}
              required
              aria-invalid={releaseStep.instanceNameError ? true : undefined}
              aria-describedby={releaseStep.instanceNameError ? instanceNameErrorId : undefined}
              className="h-9"
            />
            {releaseStep.instanceNameError && (
              <div id={instanceNameErrorId} role="alert" className="system-xs-regular text-text-destructive">
                {releaseStep.instanceNameError}
              </div>
            )}
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
              onChange={event => setInstanceDescription(event.target.value)}
              placeholder={t('createGuide.release.instanceDescriptionPlaceholder')}
              className="min-h-16 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
            />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <h3 className="system-sm-semibold text-text-primary">
            {t('createGuide.release.firstVersion')}
          </h3>
          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-name">
              {t('createGuide.release.releaseName')}
            </label>
            <Input
              id="create-guide-release-name"
              value={releaseName}
              onChange={event => setReleaseName(event.target.value)}
              placeholder={releaseStep.defaultedReleaseName}
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
              onChange={event => setReleaseDescription(event.target.value)}
              placeholder={t('createGuide.release.releaseDescriptionPlaceholder')}
              className="min-h-16 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
            />
          </div>
        </div>
      </div>
    </StepShell>
  )
}
