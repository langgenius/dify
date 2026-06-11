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
  useTargetDeployAction,
  useTargetDeployDisabled,
  useTargetSkipDeploymentAction,
  useTargetSkipDeploymentDisabled,
} from './actions.data'

export function TargetActionButtons() {
  const { t } = useTranslation('deployments')
  const deployDisabled = useTargetDeployDisabled()
  const skipDeploymentDisabled = useTargetSkipDeploymentDisabled()
  const handleDeploy = useTargetDeployAction()
  const handleSkipDeployment = useTargetSkipDeploymentAction()
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

  return (
    <>
      <Button type="button" variant="secondary" onClick={handleBack} disabled={isDeploying}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="secondary" disabled={skipDeploymentDisabled || isDeploying} onClick={handleSkipDeployment}>
        {skipLabel}
      </Button>
      <Button type="button" variant="primary" disabled={deployDisabled || isDeploying} onClick={handleDeploy}>
        {primaryLabel}
      </Button>
    </>
  )
}
