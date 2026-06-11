import type { DeployReq } from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod, WorkflowSourceApp } from '../types'
import type { DeploymentTargetSubmissionState } from './types'
import {
  selectedDeploymentRuntimeCredentials,
} from '@/features/deployments/components/runtime-credential-bindings-utils'
import { createDeploymentIdempotencyKey } from '@/features/deployments/idempotency'
import {
  createDeploymentEnvVarInputs,
} from './env-vars'

export function createInitialDeploymentRequest({
  effectiveSelectedApp,
  encodedDslContent,
  instanceDescription,
  method,
  submittedInstanceName,
  submittedReleaseDescription,
  submittedReleaseName,
  targetEnvironmentId,
  targetSubmissionState,
}: {
  effectiveSelectedApp?: WorkflowSourceApp
  encodedDslContent: string
  instanceDescription: string
  method: GuideMethod
  submittedInstanceName: string
  submittedReleaseDescription: string
  submittedReleaseName: string
  targetEnvironmentId: string
  targetSubmissionState: DeploymentTargetSubmissionState
}): DeployReq | undefined {
  const commonPayload = {
    new: {
      name: submittedInstanceName,
      description: instanceDescription.trim() || undefined,
    },
    environmentId: targetEnvironmentId,
    releaseName: submittedReleaseName,
    releaseDescription: submittedReleaseDescription || undefined,
    credentials: selectedDeploymentRuntimeCredentials(targetSubmissionState.bindingSlots, targetSubmissionState.bindingSelections),
    envVars: createDeploymentEnvVarInputs(targetSubmissionState.envVarSlots, targetSubmissionState.envVarValues),
    idempotencyKey: createDeploymentIdempotencyKey(),
    expectedDslDigest: targetSubmissionState.deploymentOptions?.dslDigest,
  } satisfies Omit<DeployReq, 'dsl' | 'sourceAppId'>

  if (method === 'importDsl') {
    return {
      ...commonPayload,
      dsl: encodedDslContent,
    }
  }

  const sourceAppId = effectiveSelectedApp?.id
  if (!sourceAppId)
    return undefined

  return {
    ...commonPayload,
    sourceAppId,
  }
}
