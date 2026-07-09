'use client'

import type { DeployRequest } from '@dify/contracts/enterprise/types.gen'
import { atom } from 'jotai'
import { atomWithMutation } from 'jotai-tanstack-query'
import { selectedDeploymentRuntimeCredentials } from '@/features/deployments/shared/components/runtime-credential-bindings-utils'
import { encodeDslContent, isWorkflowDsl } from '@/features/deployments/shared/domain/dsl'
import { unsupportedDslNodeError } from '@/features/deployments/shared/domain/error'
import { createDeploymentIdempotencyKey } from '@/features/deployments/shared/domain/idempotency'
import { consoleQuery } from '@/service/client'
import { environmentMatchesIdentifier } from './environment'
import {
  effectiveMethodAtom,
  envVarValuesAtom,
  instanceDescriptionAtom,
  instanceNameAtom,
  isCreatingDeploymentAtom,
  isCreatingReleaseOnlyAtom,
  isSubmittingDeploymentGuideAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
  selectedEnvironmentIdAtom,
  submissionUnsupportedDslNodesAtom,
} from './primitives'
import { deployableEnvironmentsQueryAtom, deploymentOptionsDataAtom } from './queries'
import { submittedReleaseReadyAtom } from './release'
import { dslContentAtom, effectiveSelectedAppAtom } from './source'
import {
  canDeployAtom,
  canSkipDeploymentAtom,
  deployableEnvironmentsAtom,
  deploymentTargetBindingSelectionsAtom,
  deploymentTargetBindingSlotsAtom,
  deploymentTargetEnvVarSlotsAtom,
  requiredBindingsReadyAtom,
  requiredEnvVarsReadyAtom,
} from './target'
import { envVarInput } from './utils'

const createAppInstanceMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions(),
)

const createReleaseMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createRelease.mutationOptions(),
)

const createInitialDeploymentMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.deploymentService.deploy.mutationOptions(),
)

export class CreateDeploymentGuideSubmissionBlockedError extends Error {
  reason: 'unsupportedDslMode' | 'deployFailed'

  constructor(reason: 'unsupportedDslMode' | 'deployFailed') {
    super(reason)
    this.reason = reason
    this.name = 'CreateDeploymentGuideSubmissionBlockedError'
  }
}

export const createDeploymentGuideSubmissionAtom = atom(null, async (get, set, {
  deployToEnvironment,
}: {
  deployToEnvironment: boolean
}) => {
  const method = get(effectiveMethodAtom)
  const dslContent = get(dslContentAtom)
  const submittedInstanceName = get(instanceNameAtom).trim()
  const submittedReleaseName = get(releaseNameAtom).trim()
  const submittedReleaseDescription = get(releaseDescriptionAtom).trim()

  if (get(isSubmittingDeploymentGuideAtom) || !get(submittedReleaseReadyAtom))
    return undefined

  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const deployableEnvironmentsQuery = get(deployableEnvironmentsQueryAtom)
  const deploymentOptions = get(deploymentOptionsDataAtom)?.options
  const envVarSlots = get(deploymentTargetEnvVarSlotsAtom)
  const envVarValues = get(envVarValuesAtom)
  const bindingSlots = get(deploymentTargetBindingSlotsAtom)
  const bindingSelections = get(deploymentTargetBindingSelectionsAtom)
  const selectedEnvironmentId = get(selectedEnvironmentIdAtom)
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || get(deployableEnvironmentsAtom)[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? get(deployableEnvironmentsAtom).find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined

  if (deployToEnvironment && !selectedEnvironment && !selectedEnvironmentId.trim())
    return undefined
  if (method === 'bindApp' && !effectiveSelectedApp?.id)
    return undefined
  if (method === 'importDsl' && !dslContent.trim())
    return undefined
  if (method === 'importDsl' && !isWorkflowDsl(dslContent))
    throw new CreateDeploymentGuideSubmissionBlockedError('unsupportedDslMode')

  set(submissionUnsupportedDslNodesAtom, [])

  try {
    if (!deployToEnvironment) {
      if (!get(canSkipDeploymentAtom))
        return undefined

      set(isCreatingReleaseOnlyAtom, true)

      try {
        const createdAppInstance = await get(createAppInstanceMutationAtom).mutateAsync({
          body: {
            displayName: submittedInstanceName,
            description: get(instanceDescriptionAtom).trim() || undefined,
          },
        })
        const appInstanceId = createdAppInstance.appInstance.id

        if (method === 'importDsl') {
          await get(createReleaseMutationAtom).mutateAsync({
            body: {
              appInstanceId,
              dsl: encodeDslContent(dslContent),
              displayName: submittedReleaseName,
              description: submittedReleaseDescription || undefined,
              createAppInstance: false,
            },
          })

          return appInstanceId
        }

        if (!effectiveSelectedApp?.id)
          return undefined

        await get(createReleaseMutationAtom).mutateAsync({
          body: {
            appInstanceId,
            sourceAppId: effectiveSelectedApp.id,
            displayName: submittedReleaseName,
            description: submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })

        return appInstanceId
      }
      finally {
        set(isCreatingReleaseOnlyAtom, false)
      }
    }

    if (!get(canDeployAtom))
      return undefined

    set(isCreatingDeploymentAtom, true)

    try {
      const selectedEnvironmentIdentifier = selectedEnvironmentId.trim()
      const freshSelectedEnvironment = selectedEnvironment || (
        selectedEnvironmentIdentifier
          ? (await deployableEnvironmentsQuery.refetch()).data?.environments.find(environment =>
              environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier),
            )
          : undefined
      )
      const targetEnvironmentId = freshSelectedEnvironment?.id
      if (!targetEnvironmentId)
        throw new CreateDeploymentGuideSubmissionBlockedError('deployFailed')

      if (!get(requiredBindingsReadyAtom))
        throw new Error('Missing required deployment binding.')
      if (!get(requiredEnvVarsReadyAtom))
        throw new Error('Missing required deployment environment variable.')

      const envVars = envVarSlots.flatMap(slot => envVarInput(slot, envVarValues[slot.key]))
      const commonDeploymentRequest = {
        newAppInstance: {
          displayName: submittedInstanceName,
          description: get(instanceDescriptionAtom).trim() || undefined,
        },
        environmentId: targetEnvironmentId,
        releaseName: submittedReleaseName,
        releaseDescription: submittedReleaseDescription || undefined,
        credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
        envVars,
        idempotencyKey: createDeploymentIdempotencyKey(),
        expectedDslDigest: deploymentOptions?.dslDigest,
      } satisfies Omit<DeployRequest, 'dsl' | 'sourceAppId'>
      const deploymentRequest = method === 'importDsl'
        ? {
            ...commonDeploymentRequest,
            dsl: encodeDslContent(dslContent),
          }
        : effectiveSelectedApp?.id
          ? {
              ...commonDeploymentRequest,
              sourceAppId: effectiveSelectedApp.id,
            }
          : undefined
      if (!deploymentRequest)
        return undefined

      const response = await get(createInitialDeploymentMutationAtom).mutateAsync({
        body: deploymentRequest,
      })

      return response.appInstance.id
    }
    finally {
      set(isCreatingDeploymentAtom, false)
    }
  }
  catch (error) {
    const unsupportedError = await unsupportedDslNodeError(error)
    if (unsupportedError?.nodes.length) {
      set(submissionUnsupportedDslNodesAtom, unsupportedError.nodes)

      return undefined
    }

    throw error
  }
})
