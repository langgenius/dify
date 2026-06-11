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
  const { t } = useTranslation('deployments')
  const canDeploy = useTargetCanDeploy()
  const canSkipDeployment = useTargetCanSkipDeployment()
  const createDeploymentAndRelease = useTargetDeploymentSubmissionAction()
  const setStep = useSetAtom(setStepAtom)
  const isDeploying = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const primaryLabel = isDeploying && !isSkippingDeployment
    ? t('createGuide.actions.deploying')
    : t('createGuide.actions.createAndDeploy')
  const skipLabel = isSkippingDeployment
    ? t('createGuide.actions.creating')
    : t('createGuide.actions.skipDeploy')

  function handleBack() {
    if (!isDeploying)
      setStep('release')
  }

  async function handleDeploy() {
    if (!canDeploy)
      return

    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={handleBack} disabled={isDeploying}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="secondary" disabled={!canSkipDeployment || isDeploying} onClick={handleSkipDeployment}>
        {skipLabel}
      </Button>
      <Button type="button" variant="primary" disabled={!canDeploy || isDeploying} onClick={handleDeploy}>
        {primaryLabel}
      </Button>
    </>
  )
}
