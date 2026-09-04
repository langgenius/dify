'use client'

import type { FormEventHandler } from 'react'
import type { DeploymentConfigurationQueryState } from './use-deployment-configuration-queries'
import type { DeploymentConfigurationValuesController } from './use-deployment-configuration-values'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'
import { useDeployWorkflow } from '../../hooks/use-deploy-workflow'
import {
  credentialProviderName,
  findInvalidDeploymentCredential,
  findInvalidDeploymentEnvironmentVariable,
  hasValidDeploymentEnvironmentVariables,
  workflowDeploymentInput,
} from './utils/workflow-deployment-input'

export function useDeploymentConfigurationForm({
  appId,
  configurationValues,
  disabled,
  environmentId,
  invalidateAppEnvironmentsOnSuccess,
  queryState,
  workflowId,
  onClose,
  onDeploymentStarted,
}: {
  appId?: string
  configurationValues: DeploymentConfigurationValuesController
  disabled: boolean
  environmentId: string
  invalidateAppEnvironmentsOnSuccess: boolean
  queryState: DeploymentConfigurationQueryState
  workflowId: string
  onClose: () => void
  onDeploymentStarted?: (operationId: string) => void
}) {
  const { t: tCommon } = useTranslation('common')
  const { t: tDeployments } = useTranslation('deployments')
  const { t: tWorkflow } = useTranslation('workflow')
  const deployMutation = useDeployWorkflow({
    appId,
    invalidateAppEnvironmentsOnSuccess,
    onSuccess: (response) => {
      onDeploymentStarted?.(response.operation.id)
      onClose()
    },
  })
  const canDeploy = Boolean(appId) && !disabled && queryState.canDeploy && !deployMutation.isPending

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!appId || !canDeploy || !queryState.deploymentOptions) return

    const values = configurationValues.getValues()
    const invalidCredential = findInvalidDeploymentCredential(
      queryState.deploymentOptions,
      values.credentials,
    )
    if (invalidCredential) {
      toast.error(
        `${credentialProviderName(invalidCredential.provider_id)}: ${
          invalidCredential.candidates.length === 0
            ? tDeployments(($) => $['deployDrawer.noCredentialCandidates'])
            : tDeployments(($) => $['deployDrawer.selectCredential'])
        }`,
      )
      return
    }

    const invalidEnvironmentVariable = findInvalidDeploymentEnvironmentVariable(
      queryState.deploymentOptions,
      values,
    )
    if (invalidEnvironmentVariable) {
      toast.error(
        `${invalidEnvironmentVariable.owner.name} · ${invalidEnvironmentVariable.slot.key}: ${tWorkflow(
          ($) => $['env.modal.valueRequired'],
        )}`,
      )
      return
    }

    if (!hasValidDeploymentEnvironmentVariables(queryState.deploymentOptions, values)) {
      toast.error(tCommon(($) => $.error))
      return
    }

    const deploymentInput = workflowDeploymentInput(queryState.deploymentOptions, values)
    if (!deploymentInput) {
      toast.error(tCommon(($) => $.error))
      return
    }

    deployMutation.mutate({
      body: deploymentInput,
      params: {
        app_id: appId,
        environment_id: environmentId,
        workflow_id: workflowId,
      },
    })
  }

  return {
    canDeploy,
    handleSubmit,
    isDeploying: deployMutation.isPending,
  }
}
