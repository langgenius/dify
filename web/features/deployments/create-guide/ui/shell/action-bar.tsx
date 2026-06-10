'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useCreateDeploymentGuideReleaseAction } from '../../flow/release-action'
import { useCreateDeploymentGuideSourceAction } from '../../flow/source-action'
import { useCreateDeploymentGuideTargetAction } from '../../flow/target-action'
import { stepAtom } from '../../state/workflow-atoms'

export function CreateDeploymentGuideActionBar() {
  const step = useAtomValue(stepAtom)

  return (
    <ActionBarFrame>
      {step === 'source' && <SourceActionButtons />}
      {step === 'release' && <ReleaseActionButtons />}
      {step === 'target' && <TargetActionButtons />}
    </ActionBarFrame>
  )
}

function ActionBarFrame({ children }: {
  children: ReactNode
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto flex items-center justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle/95 px-5 py-4 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {children}
    </div>
  )
}

function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const {
    canGoNext,
    handleNext,
  } = useCreateDeploymentGuideSourceAction()

  return (
    <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}

function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const {
    canGoNext,
    handleBack,
    handleNext,
  } = useCreateDeploymentGuideReleaseAction()

  return (
    <>
      <Button type="button" variant="secondary" onClick={handleBack}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}

function TargetActionButtons() {
  const { t } = useTranslation('deployments')
  const {
    canDeploy,
    canSkipDeployment,
    handleBack,
    handleDeploy,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment,
  } = useCreateDeploymentGuideTargetAction()
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
