'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  canDeployAtom,
  canSkipDeploymentAtom,
  createDeploymentGuideSubmissionAtom,
  CreateDeploymentGuideSubmissionBlockedError,
  isCreatingReleaseOnlyAtom,
  isSubmittingDeploymentGuideAtom,
  stepAtom,
} from '@/features/deployments/create-guide/state'
import { deploymentErrorMessage } from '@/features/deployments/error'
import { useRouter } from '@/next/navigation'

export function TargetBackButton() {
  const { t } = useTranslation('deployments')
  const setStep = useSetAtom(stepAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)

  return (
    <Button type="button" variant="secondary" onClick={() => setStep('release')} disabled={isSubmitting}>
      {t('createGuide.actions.back')}
    </Button>
  )
}

export function TargetSkipDeploymentButton() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const canSkipDeployment = useAtomValue(canSkipDeploymentAtom)
  const submitCreateDeploymentGuide = useSetAtom(createDeploymentGuideSubmissionAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const label = isSkippingDeployment
    ? t('createGuide.actions.creating')
    : t('createGuide.actions.skipDeploy')

  async function handleSkipDeployment() {
    if (!canSkipDeployment)
      return

    try {
      const appInstanceId = await submitCreateDeploymentGuide({ deployToEnvironment: false })
      if (appInstanceId)
        router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      await showSubmissionError({
        error,
        fallbackMessage: t('createGuide.errors.createReleaseFailed'),
        unsupportedDslModeMessage: t('createGuide.dsl.unsupportedMode'),
      })
    }
  }

  return (
    <Button type="button" variant="secondary" disabled={!canSkipDeployment || isSubmitting} onClick={handleSkipDeployment}>
      {label}
    </Button>
  )
}

export function TargetDeployButton() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const canDeploy = useAtomValue(canDeployAtom)
  const submitCreateDeploymentGuide = useSetAtom(createDeploymentGuideSubmissionAtom)
  const isSubmitting = useAtomValue(isSubmittingDeploymentGuideAtom)
  const isSkippingDeployment = useAtomValue(isCreatingReleaseOnlyAtom)
  const label = isSubmitting && !isSkippingDeployment
    ? t('createGuide.actions.deploying')
    : t('createGuide.actions.createAndDeploy')

  async function handleDeploy() {
    if (!canDeploy)
      return

    try {
      const appInstanceId = await submitCreateDeploymentGuide({ deployToEnvironment: true })
      if (appInstanceId)
        router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      await showSubmissionError({
        error,
        fallbackMessage: t('createGuide.errors.deployFailed'),
        unsupportedDslModeMessage: t('createGuide.dsl.unsupportedMode'),
      })
    }
  }

  return (
    <Button type="button" variant="primary" disabled={!canDeploy || isSubmitting} onClick={handleDeploy}>
      {label}
    </Button>
  )
}

async function showSubmissionError({
  error,
  fallbackMessage,
  unsupportedDslModeMessage,
}: {
  error: unknown
  fallbackMessage: string
  unsupportedDslModeMessage: string
}) {
  if (error instanceof CreateDeploymentGuideSubmissionBlockedError) {
    toast.error(error.reason === 'unsupportedDslMode' ? unsupportedDslModeMessage : fallbackMessage)
    return
  }

  toast.error(await deploymentErrorMessage(error) || fallbackMessage)
}
