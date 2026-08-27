'use client'

import type { FormEventHandler } from 'react'
import type { DeploymentConfigurationQueryState } from './use-deployment-configuration-queries'
import type { DeploymentConfigurationValuesController } from './use-deployment-configuration-values'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'
import { useDeployWorkflow } from '../../hooks/use-deploy-workflow'
import {
  hasRequiredDeploymentCredentials,
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
  const { t } = useTranslation('workflow')
  const hasRequiredCredentials = queryState.deploymentOptions
    ? hasRequiredDeploymentCredentials(
        queryState.deploymentOptions,
        configurationValues.credentials,
      )
    : false
  const deployMutation = useDeployWorkflow({
    appId,
    invalidateAppEnvironmentsOnSuccess,
    onSuccess: (response) => {
      onDeploymentStarted?.(response.operation.id)
      onClose()
    },
  })
  const canDeploy =
    Boolean(appId) &&
    !disabled &&
    queryState.canDeploy &&
    hasRequiredCredentials &&
    !deployMutation.isPending

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!appId || !canDeploy || !queryState.deploymentOptions) return

    const values = configurationValues.getValues()
    if (!hasValidDeploymentEnvironmentVariables(queryState.deploymentOptions, values)) {
      toast.error(t(($) => $['env.modal.valueRequired']))
      return
    }

    const deploymentInput = workflowDeploymentInput(queryState.deploymentOptions, values)
    if (!deploymentInput) return

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
