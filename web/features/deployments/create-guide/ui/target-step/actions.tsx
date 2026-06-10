'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useTargetAction } from './actions.data'

export function TargetActionButtons() {
  const { t } = useTranslation('deployments')
  const {
    canDeploy,
    canSkipDeployment,
    handleBack,
    handleDeploy,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment,
  } = useTargetAction()
  const primaryLabel = isDeploying && !isSkippingDeployment
    ? t('createGuide.actions.deploying')
    : t('createGuide.actions.createAndDeploy')
  const skipLabel = isSkippingDeployment
    ? t('createGuide.actions.creating')
    : t('createGuide.actions.skipDeploy')

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
