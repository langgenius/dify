'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  continueFromReleaseAtom,
  dslDefaultAppNameAtom,
  hasInstanceNameConflictAtom,
  instanceDescriptionAtom,
  instanceNameAtom,
  methodAtom,
  releaseCanGoNextAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
  selectedAppAtom,
  setInstanceDescriptionAtom,
  setInstanceNameAtom,
  setReleaseDescriptionAtom,
  setReleaseNameAtom,
  stepAtom,
} from '@/features/deployments/create-guide/state'
import { StepShell } from './layout'

const releaseTextareaClassName = 'min-h-16 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'

export function ReleaseStepContent() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.release.title')}
      description={t('createGuide.release.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <DeploymentInfoSection />
        <InitialReleaseSection />
      </div>
    </StepShell>
  )
}

function DeploymentInfoSection() {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex flex-col gap-4">
      <h3 className="system-sm-semibold text-text-primary">
        {t('createGuide.release.deployInfo')}
      </h3>
      <InstanceNameField />
      <InstanceDescriptionField />
    </div>
  )
}

function InitialReleaseSection() {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex flex-col gap-4">
      <h3 className="system-sm-semibold text-text-primary">
        {t('createGuide.release.firstVersion')}
      </h3>
      <ReleaseNameField />
      <ReleaseDescriptionField />
    </div>
  )
}

function InstanceNameField() {
  const { t } = useTranslation('deployments')
  const instanceName = useAtomValue(instanceNameAtom)
  const setInstanceName = useSetAtom(setInstanceNameAtom)
  const method = useAtomValue(methodAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslDefaultAppName = useAtomValue(dslDefaultAppNameAtom)
  const instanceNamePlaceholder = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : selectedApp?.name
  const hasInstanceNameConflict = useAtomValue(hasInstanceNameConflictAtom)
  const instanceNameError = hasInstanceNameConflict
    ? t('createGuide.release.instanceNameConflict')
    : undefined
  const instanceNameErrorId = 'create-guide-instance-name-error'

  return (
    <div className="flex flex-col gap-2">
      <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-name">
        {t('createGuide.release.instanceName')}
      </label>
      <Input
        id="create-guide-instance-name"
        value={instanceName}
        onChange={event => setInstanceName(event.target.value)}
        placeholder={instanceNamePlaceholder}
        required
        aria-invalid={instanceNameError ? true : undefined}
        aria-describedby={instanceNameError ? instanceNameErrorId : undefined}
        className="h-9"
      />
      {instanceNameError && (
        <div id={instanceNameErrorId} role="alert" className="system-xs-regular text-text-destructive">
          {instanceNameError}
        </div>
      )}
    </div>
  )
}

function InstanceDescriptionField() {
  const { t } = useTranslation('deployments')
  const instanceDescription = useAtomValue(instanceDescriptionAtom)
  const setInstanceDescription = useSetAtom(setInstanceDescriptionAtom)

  return (
    <div className="flex flex-col gap-2">
      <OptionalFieldLabel htmlFor="create-guide-instance-description">
        {t('createGuide.release.instanceDescription')}
      </OptionalFieldLabel>
      <textarea
        id="create-guide-instance-description"
        value={instanceDescription}
        onChange={event => setInstanceDescription(event.target.value)}
        placeholder={t('createGuide.release.instanceDescriptionPlaceholder')}
        className={releaseTextareaClassName}
      />
    </div>
  )
}

function ReleaseNameField() {
  const { t } = useTranslation('deployments')
  const releaseName = useAtomValue(releaseNameAtom)
  const setReleaseName = useSetAtom(setReleaseNameAtom)

  return (
    <div className="flex flex-col gap-2">
      <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-name">
        {t('createGuide.release.releaseName')}
      </label>
      <Input
        id="create-guide-release-name"
        value={releaseName}
        onChange={event => setReleaseName(event.target.value)}
        placeholder={t('createGuide.release.defaultName')}
        required
        className="h-9"
      />
    </div>
  )
}

function ReleaseDescriptionField() {
  const { t } = useTranslation('deployments')
  const releaseDescription = useAtomValue(releaseDescriptionAtom)
  const setReleaseDescription = useSetAtom(setReleaseDescriptionAtom)

  return (
    <div className="flex flex-col gap-2">
      <OptionalFieldLabel htmlFor="create-guide-release-description">
        {t('createGuide.release.releaseDescription')}
      </OptionalFieldLabel>
      <textarea
        id="create-guide-release-description"
        value={releaseDescription}
        onChange={event => setReleaseDescription(event.target.value)}
        placeholder={t('createGuide.release.releaseDescriptionPlaceholder')}
        className={releaseTextareaClassName}
      />
    </div>
  )
}

function OptionalFieldLabel({ children, htmlFor }: {
  children: string
  htmlFor: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex items-center gap-1.5">
      <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor={htmlFor}>
        {children}
      </label>
      <span className="system-xs-regular text-text-quaternary">{t('versions.optional')}</span>
    </div>
  )
}

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(releaseCanGoNextAtom)
  const setStep = useSetAtom(stepAtom)
  const continueFromRelease = useSetAtom(continueFromReleaseAtom)

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setStep('source')}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canGoNext} onClick={continueFromRelease}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
