'use client'

import type { SubmitEventHandler } from 'react'
import type { DeploymentConfigurationQueryState } from './use-deployment-configuration-queries'
import type { DeploymentConfigurationValuesController } from './use-deployment-configuration-values'
import type { DeploymentFieldError } from './utils/field-id'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useDeployWorkflow } from '../../hooks/use-deploy-workflow'
import { credentialFieldId, environmentVariableFieldId } from './utils/field-id'
import {
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
  const { t: tCommon } = useTranslation(['common'])
  const { t: tDeployments } = useTranslation(['deployments'])
  const { t: tWorkflow } = useTranslation(['workflow'])
  const [fieldError, setFieldError] = useState<DeploymentFieldError>()
  const formRef = useRef<HTMLFormElement | null>(null)
  useLayoutEffect(() => {
    if (fieldError)
      formRef.current?.querySelector<HTMLElement>(`[id="${fieldError.fieldId}"]`)?.focus()
  }, [fieldError])
  const deployMutation = useDeployWorkflow({
    appId,
    invalidateAppEnvironmentsOnSuccess,
    onSuccess: (response) => {
      onDeploymentStarted?.(response.operation.id)
      onClose()
    },
  })
  const canDeploy = Boolean(appId) && !disabled && queryState.canDeploy && !deployMutation.isPending

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!appId || !canDeploy || !queryState.deploymentOptions) return

    const values = configurationValues.getValues()
    const invalidCredential = findInvalidDeploymentCredential(
      queryState.deploymentOptions,
      values.credentials,
    )
    if (invalidCredential) {
      setFieldError({
        fieldId: credentialFieldId(invalidCredential),
        message:
          invalidCredential.candidates.length === 0
            ? tDeployments(($) => $['deployDrawer.noCredentialCandidates'])
            : tDeployments(($) => $['deployDrawer.selectCredential']),
      })
      return
    }

    const invalidEnvironmentVariable = findInvalidDeploymentEnvironmentVariable(
      queryState.deploymentOptions,
      values,
    )
    if (invalidEnvironmentVariable) {
      setFieldError({
        fieldId: environmentVariableFieldId(
          invalidEnvironmentVariable.owner.workflow_id,
          invalidEnvironmentVariable.slot.key,
        ),
        message: tWorkflow(($) => $['env.modal.valueRequired']),
      })
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
    clearFieldError: () => setFieldError(undefined),
    fieldError,
    formRef,
    handleSubmit,
    isDeploying: deployMutation.isPending,
  }
}
