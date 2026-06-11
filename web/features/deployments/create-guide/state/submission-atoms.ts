'use client'

import type { Getter, Setter } from 'jotai'
import type { WorkflowSourceApp } from './types'
import { atom } from 'jotai'
import { atomWithMutation } from 'jotai-tanstack-query'
import { isWorkflowDsl } from '@/features/deployments/dsl'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import { consoleQuery } from '@/service/client'
import {
  dslContentAtom,
  encodedDslContentAtom,
  hasDslContentAtom,
} from './dsl-atoms'
import {
  instanceDescriptionAtom,
  instanceNameAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
} from './release-atoms'
import { submittedReleaseReadyAtom } from './release-derived-atoms'
import { selectedAppAtom } from './source-atoms'
import {
  isCreatingDeploymentAtom,
  isCreatingReleaseOnlyAtom,
  isSubmittingDeploymentGuideAtom,
} from './submission-busy-atoms'
import { createInitialDeploymentRequest } from './submission-payload'
import {
  hasMissingDeploymentTargetBinding,
  resolveSelectedDeploymentEnvironmentId,
} from './submission-target'
import { deploymentTargetSubmissionStateAtom } from './target-derived-atoms'
import { submissionUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'
import { methodAtom } from './workflow-atoms'

const createDeploymentSubmissionDraftAtom = atom(get => ({
  dslContent: get(dslContentAtom),
  encodedDslContent: get(encodedDslContentAtom),
  hasDslContent: get(hasDslContentAtom),
  instanceDescription: get(instanceDescriptionAtom),
  method: get(methodAtom),
  submittedInstanceName: get(instanceNameAtom).trim(),
  submittedReleaseDescription: get(releaseDescriptionAtom).trim(),
  submittedReleaseName: get(releaseNameAtom).trim(),
}))

const createAppInstanceMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions(),
)

const createReleaseFromDslMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions(),
)

const createReleaseFromSourceAppMutationAtom = atomWithMutation(() =>
  consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions(),
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

async function captureUnsupportedDslNodeError(
  set: Setter,
  error: unknown,
) {
  const unsupportedError = await unsupportedDslNodeError(error)
  if (!unsupportedError?.nodes.length)
    return false

  set(submissionUnsupportedDslNodesAtom, unsupportedError.nodes)

  return true
}

async function createReleaseOnlyAppInstance({
  effectiveSelectedApp,
  get,
}: {
  effectiveSelectedApp?: WorkflowSourceApp
  get: Getter
}) {
  const submissionDraft = get(createDeploymentSubmissionDraftAtom)
  const createdAppInstance = await get(createAppInstanceMutationAtom).mutateAsync({
    body: {
      name: submissionDraft.submittedInstanceName,
      description: submissionDraft.instanceDescription.trim() || undefined,
    },
  })
  const appInstanceId = createdAppInstance.appInstance.id

  if (submissionDraft.method === 'importDsl') {
    await get(createReleaseFromDslMutationAtom).mutateAsync({
      body: {
        appInstanceId,
        dsl: submissionDraft.encodedDslContent,
        name: submissionDraft.submittedReleaseName,
        description: submissionDraft.submittedReleaseDescription || undefined,
        createAppInstance: false,
      },
    })

    return appInstanceId
  }

  if (!effectiveSelectedApp?.id)
    return undefined

  await get(createReleaseFromSourceAppMutationAtom).mutateAsync({
    body: {
      appInstanceId,
      sourceAppId: effectiveSelectedApp.id,
      name: submissionDraft.submittedReleaseName,
      description: submissionDraft.submittedReleaseDescription || undefined,
      createAppInstance: false,
    },
  })

  return appInstanceId
}

export const createDeploymentGuideSubmissionAtom = atom(null, async (get, set, {
  deployToEnvironment,
}: {
  deployToEnvironment: boolean
}) => {
  if (get(isSubmittingDeploymentGuideAtom) || !get(submittedReleaseReadyAtom))
    return undefined

  const submissionDraft = get(createDeploymentSubmissionDraftAtom)
  const effectiveSelectedApp = get(selectedAppAtom)
  const targetSubmissionState = get(deploymentTargetSubmissionStateAtom)

  if (deployToEnvironment && !targetSubmissionState.selectedEnvironment && !targetSubmissionState.selectedEnvironmentId?.trim())
    return undefined
  if (submissionDraft.method === 'bindApp' && !effectiveSelectedApp?.id)
    return undefined
  if (submissionDraft.method === 'importDsl' && !submissionDraft.hasDslContent)
    return undefined
  if (submissionDraft.method === 'importDsl' && !isWorkflowDsl(submissionDraft.dslContent))
    throw new CreateDeploymentGuideSubmissionBlockedError('unsupportedDslMode')

  set(submissionUnsupportedDslNodesAtom, [])

  try {
    if (!deployToEnvironment) {
      set(isCreatingReleaseOnlyAtom, true)

      return await createReleaseOnlyAppInstance({
        effectiveSelectedApp,
        get,
      }).finally(() => {
        set(isCreatingReleaseOnlyAtom, false)
      })
    }

    const targetEnvironmentId = await resolveSelectedDeploymentEnvironmentId(targetSubmissionState)
    if (!targetEnvironmentId)
      throw new CreateDeploymentGuideSubmissionBlockedError('deployFailed')

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
      return undefined

    set(isCreatingDeploymentAtom, true)

    const response = await get(createInitialDeploymentMutationAtom).mutateAsync({
      body: deploymentRequest,
    }).finally(() => {
      set(isCreatingDeploymentAtom, false)
    })

    return response.appInstance.id
  }
  catch (error) {
    if (await captureUnsupportedDslNodeError(set, error))
      return undefined

    throw error
  }
})
