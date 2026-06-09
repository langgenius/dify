'use client'

import type {
  CredentialSlot,
  EnvVarSlot,
  ListDeployableEnvironmentsReply,
} from '@dify/contracts/enterprise/types.gen'
import type { QueryObserverResult } from '@tanstack/react-query'
import type { EnvVarValues } from '../components/env-var-bindings-utils'
import type { RuntimeCredentialBindingSelections } from '../components/runtime-credential-bindings-utils'
import type { UnsupportedDslNode } from '../error'
import type { EnvironmentOption, GuideMethod } from './types'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { isWorkflowApp } from '../app-mode'
import {
  hasMissingRequiredEnvVarValue,
  selectedDeploymentEnvVars,
} from '../components/env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
} from '../components/runtime-credential-bindings-utils'
import { isWorkflowDsl } from '../dsl'
import {
  environmentDeploymentId,
  environmentMatchesIdentifier,
} from '../environment'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../error'
import { createDeploymentIdempotencyKey } from '../idempotency'
import { deploymentEnvironmentOptions } from './use-deployment-target-options'

type RefetchDeployableEnvironments = () => Promise<QueryObserverResult<ListDeployableEnvironmentsReply>>

export function useCreateDeploymentSubmission({
  bindingSelections,
  bindingSlots,
  deploymentOptionsDslDigest,
  dslContent,
  effectiveEnvVarValues,
  effectiveSelectedApp,
  encodedDslContent,
  envVarSlots,
  hasDslContent,
  hasInstanceNameConflict,
  instanceDescription,
  isInitialReleaseReady,
  method,
  refetchDeployableEnvironments,
  selectedEnvironment,
  selectedEnvironmentId,
  setSubmissionUnsupportedDslNodes,
  submittedInstanceName,
  submittedReleaseDescription,
  submittedReleaseName,
}: {
  bindingSelections: RuntimeCredentialBindingSelections
  bindingSlots: CredentialSlot[]
  deploymentOptionsDslDigest?: string
  dslContent: string
  effectiveEnvVarValues: EnvVarValues
  effectiveSelectedApp?: App
  encodedDslContent: string
  envVarSlots: EnvVarSlot[]
  hasDslContent: boolean
  hasInstanceNameConflict: boolean
  instanceDescription: string
  isInitialReleaseReady: boolean
  method: GuideMethod
  refetchDeployableEnvironments: RefetchDeployableEnvironments
  selectedEnvironment?: EnvironmentOption
  selectedEnvironmentId: string
  setSubmissionUnsupportedDslNodes: (nodes: UnsupportedDslNode[]) => void
  submittedInstanceName: string
  submittedReleaseDescription: string
  submittedReleaseName: string
}) {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const createAppInstance = useMutation(consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions())
  const createReleaseFromDsl = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions())
  const createReleaseFromSourceApp = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const createInitialDeployment = useMutation(consoleQuery.enterprise.deploymentService.deploy.mutationOptions())
  const [isSkippingReleaseOnly, setIsSkippingReleaseOnly] = useState(false)
  const isDeploying = isSkippingReleaseOnly || createInitialDeployment.isPending

  async function createInitialReleaseOnly() {
    setIsSkippingReleaseOnly(true)

    try {
      const createdAppInstance = await createAppInstance.mutateAsync({
        body: {
          name: submittedInstanceName,
          description: instanceDescription.trim() || undefined,
        },
      })
      const appInstanceId = createdAppInstance.appInstance?.id
      if (!appInstanceId)
        throw new Error('Create app instance did not return an app instance.')

      const createdRelease = method === 'importDsl'
        ? await createReleaseFromDsl.mutateAsync({
            body: {
              appInstanceId,
              dsl: encodedDslContent,
              name: submittedReleaseName,
              description: submittedReleaseDescription || undefined,
              createAppInstance: false,
            },
          })
        : effectiveSelectedApp?.id
          ? await createReleaseFromSourceApp.mutateAsync({
              body: {
                appInstanceId,
                sourceAppId: effectiveSelectedApp.id,
                name: submittedReleaseName,
                description: submittedReleaseDescription || undefined,
                createAppInstance: false,
              },
            })
          : undefined

      if (!createdRelease?.release?.id)
        throw new Error('Create release did not return a release.')

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    finally {
      setIsSkippingReleaseOnly(false)
    }
  }

  async function resolveSelectedDeploymentEnvironmentId() {
    const currentEnvironmentId = environmentDeploymentId(selectedEnvironment)
    if (currentEnvironmentId)
      return currentEnvironmentId

    const selectedEnvironmentIdentifier = selectedEnvironmentId || selectedEnvironment?.id || selectedEnvironment?.name || ''
    const selectedEnvironmentName = selectedEnvironment?.name || ''
    const freshResult = await refetchDeployableEnvironments()
    const freshEnvironments = deploymentEnvironmentOptions(freshResult.data?.data)
    const freshSelectedEnvironment = freshEnvironments.find(environment => (
      environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier)
      || (selectedEnvironmentName && environment.name === selectedEnvironmentName)
    )) ?? freshEnvironments[0]

    return environmentDeploymentId(freshSelectedEnvironment)
  }

  async function createDeploymentAndRelease({ deployToEnvironment }: {
    deployToEnvironment: boolean
  }) {
    if (isDeploying || !isInitialReleaseReady)
      return
    if (hasInstanceNameConflict)
      return
    if (deployToEnvironment && !selectedEnvironment?.id)
      return
    if (method === 'bindApp' && (!effectiveSelectedApp?.id || !isWorkflowApp(effectiveSelectedApp)))
      return
    if (method === 'importDsl' && !hasDslContent)
      return
    if (method === 'importDsl' && !isWorkflowDsl(dslContent)) {
      toast.error(t('createGuide.dsl.unsupportedMode'))
      return
    }

    setSubmissionUnsupportedDslNodes([])
    try {
      if (!deployToEnvironment) {
        await createInitialReleaseOnly()
        return
      }

      const targetEnvironmentId = await resolveSelectedDeploymentEnvironmentId()
      if (!targetEnvironmentId) {
        toast.error(t('createGuide.errors.deployFailed'))
        return
      }

      const missingRequiredBinding = bindingSlots.some(slot => hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]))
      if (missingRequiredBinding)
        throw new Error('Missing required deployment binding.')
      const missingRequiredEnvVar = envVarSlots.some(slot => hasMissingRequiredEnvVarValue(slot, effectiveEnvVarValues))
      if (missingRequiredEnvVar)
        throw new Error('Missing required deployment environment variable.')

      const idempotencyKey = createDeploymentIdempotencyKey()
      const response = method === 'importDsl'
        ? await createInitialDeployment.mutateAsync({
            body: {
              dsl: encodedDslContent,
              new: {
                name: submittedInstanceName,
                description: instanceDescription.trim() || undefined,
              },
              environmentId: targetEnvironmentId,
              releaseName: submittedReleaseName,
              releaseDescription: submittedReleaseDescription || undefined,
              credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
              envVars: selectedDeploymentEnvVars(envVarSlots, effectiveEnvVarValues),
              idempotencyKey,
              expectedDslDigest: deploymentOptionsDslDigest,
            },
          })
        : effectiveSelectedApp?.id
          ? await createInitialDeployment.mutateAsync({
              body: {
                sourceAppId: effectiveSelectedApp.id,
                new: {
                  name: submittedInstanceName,
                  description: instanceDescription.trim() || undefined,
                },
                environmentId: targetEnvironmentId,
                releaseName: submittedReleaseName,
                releaseDescription: submittedReleaseDescription || undefined,
                credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
                envVars: selectedDeploymentEnvVars(envVarSlots, effectiveEnvVarValues),
                idempotencyKey,
                expectedDslDigest: deploymentOptionsDslDigest,
              },
            })
          : undefined
      const appInstanceId = response?.appInstance?.id ?? response?.release?.appInstanceId
      if (!appInstanceId)
        throw new Error('Create initial deployment did not return an app instance.')

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      const unsupportedError = await unsupportedDslNodeError(error)
      if (unsupportedError?.nodes.length) {
        setSubmissionUnsupportedDslNodes(unsupportedError.nodes)
        return
      }

      const fallbackMessage = t(deployToEnvironment ? 'createGuide.errors.deployFailed' : 'createGuide.errors.createReleaseFailed')
      toast.error(await deploymentErrorMessage(error) || fallbackMessage)
    }
  }

  return {
    createDeploymentAndRelease,
    isDeploying,
    isSkippingReleaseOnly,
  }
}
