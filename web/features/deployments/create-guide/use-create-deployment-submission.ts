'use client'

import type {
  CredentialSlot,
  DeployReply,
  Environment,
  EnvVarInput,
  ListDeployableEnvironmentsReply,
} from '@dify/contracts/enterprise/types.gen'
import type { QueryObserverResult } from '@tanstack/react-query'
import type { EnvVarBindingSlot, EnvVarValues } from '../components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '../components/runtime-credential-bindings-utils'
import type { UnsupportedDslNode } from '../error'
import type { GuideMethod } from './types'
import type { App } from '@/types/app'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { isWorkflowApp } from '../app-mode'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
} from '../components/runtime-credential-bindings-utils'
import { isWorkflowDsl } from '../dsl'
import {
  environmentMatchesIdentifier,
} from '../environment'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../error'
import { createDeploymentIdempotencyKey } from '../idempotency'

type RefetchDeployableEnvironments = () => Promise<QueryObserverResult<ListDeployableEnvironmentsReply>>

export function useCreateDeploymentSubmission({
  bindingSelections,
  bindingSlots,
  deploymentOptionsDslDigest,
  dslContent,
  envVarValues,
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
  envVarValues: EnvVarValues
  effectiveSelectedApp?: App
  encodedDslContent: string
  envVarSlots: EnvVarBindingSlot[]
  hasDslContent: boolean
  hasInstanceNameConflict: boolean
  instanceDescription: string
  isInitialReleaseReady: boolean
  method: GuideMethod
  refetchDeployableEnvironments: RefetchDeployableEnvironments
  selectedEnvironment?: Environment
  selectedEnvironmentId?: string
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
      const appInstanceId = createdAppInstance.appInstance.id

      if (method === 'importDsl') {
        await createReleaseFromDsl.mutateAsync({
          body: {
            appInstanceId,
            dsl: encodedDslContent,
            name: submittedReleaseName,
            description: submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })
      }
      else if (effectiveSelectedApp?.id) {
        await createReleaseFromSourceApp.mutateAsync({
          body: {
            appInstanceId,
            sourceAppId: effectiveSelectedApp.id,
            name: submittedReleaseName,
            description: submittedReleaseDescription || undefined,
            createAppInstance: false,
          },
        })
      }
      else {
        return
      }

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    finally {
      setIsSkippingReleaseOnly(false)
    }
  }

  async function resolveSelectedDeploymentEnvironmentId() {
    if (selectedEnvironment)
      return selectedEnvironment.id

    const selectedEnvironmentIdentifier = selectedEnvironmentId?.trim()
    if (!selectedEnvironmentIdentifier)
      return undefined

    const freshResult = await refetchDeployableEnvironments()
    const freshEnvironments = freshResult.data?.data ?? []
    const freshSelectedEnvironment = freshEnvironments.find(environment => environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier))

    return freshSelectedEnvironment?.id
  }

  async function createDeploymentAndRelease({ deployToEnvironment }: {
    deployToEnvironment: boolean
  }) {
    if (isDeploying || !isInitialReleaseReady)
      return
    if (hasInstanceNameConflict)
      return
    if (deployToEnvironment && !selectedEnvironment && !selectedEnvironmentId?.trim())
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
      const missingRequiredEnvVar = envVarSlots.some((slot) => {
        const selection = envVarValues[slot.key]
        const valueSource = selection?.valueSource
          ?? (slot.hasDefaultValue
            ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
            : slot.hasLastValue
              ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
              : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)

        if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
          return !slot.hasLastValue
        if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
          return !slot.hasDefaultValue
        if (!selection?.value)
          return true

        return slot.valueType === 'number' && Number.isNaN(Number(selection.value))
      })
      if (missingRequiredEnvVar)
        throw new Error('Missing required deployment environment variable.')

      const idempotencyKey = createDeploymentIdempotencyKey()
      const envVars = envVarSlots.flatMap((slot): EnvVarInput[] => {
        const selection = envVarValues[slot.key]
        const valueSource = selection?.valueSource
          ?? (slot.hasDefaultValue
            ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
            : slot.hasLastValue
              ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
              : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)

        if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
          return slot.hasLastValue
            ? [{ key: slot.key, valueSource }]
            : []
        }

        if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
          return slot.hasDefaultValue
            ? [{ key: slot.key, valueSource }]
            : []
        }

        if (!selection?.value || (slot.valueType === 'number' && Number.isNaN(Number(selection.value))))
          return []

        return [{
          key: slot.key,
          value: selection.value,
          valueSource,
        }]
      })
      let response: DeployReply
      if (method === 'importDsl') {
        response = await createInitialDeployment.mutateAsync({
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
            envVars,
            idempotencyKey,
            expectedDslDigest: deploymentOptionsDslDigest,
          },
        })
      }
      else {
        const sourceAppId = effectiveSelectedApp?.id
        if (!sourceAppId)
          return

        response = await createInitialDeployment.mutateAsync({
          body: {
            sourceAppId,
            new: {
              name: submittedInstanceName,
              description: instanceDescription.trim() || undefined,
            },
            environmentId: targetEnvironmentId,
            releaseName: submittedReleaseName,
            releaseDescription: submittedReleaseDescription || undefined,
            credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
            envVars,
            idempotencyKey,
            expectedDslDigest: deploymentOptionsDslDigest,
          },
        })
      }
      const appInstanceId = response.appInstance.id

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
