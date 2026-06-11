'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  isCreatingReleaseOnlyAtom,
  isSubmittingDeploymentGuideAtom,
} from '../../state/submission-atoms'
import { setStepAtom } from '../../state/workflow-atoms'
import {
  useTargetCanDeploy,
  useTargetCanSkipDeployment,
  useTargetDeploymentSubmissionAction,
} from './actions.data'

export function TargetActionButtons() {
  return (
    <>
      <TargetBackButton />
      <TargetSkipDeploymentButton />
      <TargetDeployButton />
    </>
  )
}

function TargetBackButton() {
  const { t } = useTranslation('deployments')
  const setStep = useSetAtom(setStepAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)

  function handleBack() {
    if (!isSubmitting)
      setStep('release')
  }

  return (
    <Button type="button" variant="secondary" onClick={handleBack} disabled={isSubmitting}>
      {t('createGuide.actions.back')}
    </Button>
  )
}

function TargetSkipDeploymentButton() {
  const { t } = useTranslation('deployments')
  const canSkipDeployment = useTargetCanSkipDeployment()
  const createDeploymentAndRelease = useTargetDeploymentSubmissionAction()
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const label = isSkippingDeployment
    ? t('createGuide.actions.creating')
    : t('createGuide.actions.skipDeploy')

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return (
    <Button type="button" variant="secondary" disabled={!canSkipDeployment || isSubmitting} onClick={handleSkipDeployment}>
      {label}
    </Button>
  )
}

function TargetDeployButton() {
  const { t } = useTranslation('deployments')
  const canDeploy = useTargetCanDeploy()
  const createDeploymentAndRelease = useTargetDeploymentSubmissionAction()
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const label = isSubmitting && !isSkippingDeployment
    ? t('createGuide.actions.deploying')
    : t('createGuide.actions.createAndDeploy')

  async function handleDeploy() {
    if (!canDeploy)
      return

    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  return (
    <Button type="button" variant="primary" disabled={!canDeploy || isSubmitting} onClick={handleDeploy}>
      {label}
    </Button>
  )
}
