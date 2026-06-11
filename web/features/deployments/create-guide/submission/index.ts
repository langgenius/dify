'use client'

import type { WorkflowSourceApp } from '../types'
import type { DeploymentTargetSubmissionState } from './types'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { isWorkflowDsl } from '@/features/deployments/dsl'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import {
  isCreatingDeploymentAtom,
  isSubmittingDeploymentGuideAtom,
} from '../state/submission-atoms'
import {
  setSubmissionUnsupportedDslNodesAtom,
} from '../state/unsupported-dsl-atoms'
import { useCreateDeploymentSubmissionDraft } from './draft'
import { handleCreateDeploymentSubmissionError } from './errors'
import { createInitialDeploymentRequest } from './payload'
import { useCreateReleaseOnlySubmission } from './release-only'
import {
  hasMissingDeploymentTargetBinding,
  resolveSelectedDeploymentEnvironmentId,
} from './target'

export function useCreateDeploymentSubmission({
  effectiveSelectedApp,
  hasInstanceNameConflict,
  isInitialReleaseReady,
  targetSubmissionState,
}: {
  effectiveSelectedApp?: WorkflowSourceApp
  hasInstanceNameConflict: boolean
  isInitialReleaseReady: boolean
  targetSubmissionState: DeploymentTargetSubmissionState
}) {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const submissionDraft = useCreateDeploymentSubmissionDraft()
  const setSubmissionUnsupportedDslNodes = useSetAtom(setSubmissionUnsupportedDslNodesAtom)
  const setIsCreatingDeployment = useSetAtom(isCreatingDeploymentAtom)
  const isSubmittingDeploymentGuide = useAtomValue(isSubmittingDeploymentGuideAtom)
  const createInitialDeployment = useMutation(consoleQuery.enterprise.deploymentService.deploy.mutationOptions())
  const {
    createInitialReleaseOnly,
    isSkippingReleaseOnly,
  } = useCreateReleaseOnlySubmission({
    effectiveSelectedApp,
    submissionDraft,
  })
  const isDeploying = isSubmittingDeploymentGuide || createInitialDeployment.isPending

  async function createDeploymentAndRelease({ deployToEnvironment }: {
    deployToEnvironment: boolean
  }) {
    if (isDeploying || !isInitialReleaseReady)
      return
    if (hasInstanceNameConflict)
      return
    if (deployToEnvironment && !targetSubmissionState.selectedEnvironment && !targetSubmissionState.selectedEnvironmentId?.trim())
      return
    if (submissionDraft.method === 'bindApp' && !effectiveSelectedApp?.id)
      return
    if (submissionDraft.method === 'importDsl' && !submissionDraft.hasDslContent)
      return
    if (submissionDraft.method === 'importDsl' && !isWorkflowDsl(submissionDraft.dslContent)) {
      toast.error(t('createGuide.dsl.unsupportedMode'))
      return
    }

    setSubmissionUnsupportedDslNodes([])
    try {
      if (!deployToEnvironment) {
        await createInitialReleaseOnly()
        return
      }

      const targetEnvironmentId = await resolveSelectedDeploymentEnvironmentId(targetSubmissionState)
      if (!targetEnvironmentId) {
        toast.error(t('createGuide.errors.deployFailed'))
        return
      }

      if (hasMissingDeploymentTargetBinding(targetSubmissionState))
        throw new Error('Missing required deployment binding.')
      if (!targetSubmissionState.requiredEnvVarsReady)
        throw new Error('Missing required deployment environment variable.')

      const deploymentRequest = createInitialDeploymentRequest({
        effectiveSelectedApp,
        encodedDslContent: submissionDraft.encodedDslContent,
        instanceDescription: submissionDraft.instanceDescription,
        method: submissionDraft.method,
        submittedInstanceName: submissionDraft.submittedInstanceName,
        submittedReleaseDescription: submissionDraft.submittedReleaseDescription,
        submittedReleaseName: submissionDraft.submittedReleaseName,
        targetEnvironmentId,
        targetSubmissionState,
      })
      if (!deploymentRequest)
        return

      setIsCreatingDeployment(true)
      const response = await createInitialDeployment.mutateAsync({
        body: deploymentRequest,
      }).finally(() => {
        setIsCreatingDeployment(false)
      })
      const appInstanceId = response.appInstance.id

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      await handleCreateDeploymentSubmissionError({
        error,
        fallbackMessage: t(deployToEnvironment ? 'createGuide.errors.deployFailed' : 'createGuide.errors.createReleaseFailed'),
        setSubmissionUnsupportedDslNodes,
      })
    }
  }

  return {
    createDeploymentAndRelease,
    isDeploying,
    isSkippingReleaseOnly,
  }
}
