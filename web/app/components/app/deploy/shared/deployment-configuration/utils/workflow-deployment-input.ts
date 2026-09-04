import type {
  CredentialSlot,
  EnvironmentVariableSlot,
  GetWorkflowDeploymentOptionsResponse,
  WorkflowDeploymentInput,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValues } from '../use-deployment-configuration-values'
import {
  EnvVarValueSource as EnvVarValueSourceEnum,
  EnvVarValueType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { isLLMEnvironmentVariableValue } from '@/app/components/workflow/llm-environment-variable'
import { environmentVariableSelectionKey } from '../use-deployment-configuration-values'

export function credentialSlotKey(slot: CredentialSlot) {
  return `${slot.provider_id}:${slot.category}`
}

export function credentialProviderName(providerId: string) {
  const name = providerId.split('/').filter(Boolean).at(-1) ?? providerId

  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function defaultCredentialId(slot: CredentialSlot) {
  if (
    slot.last_deployed_credential_id &&
    slot.candidates.some(
      (candidate) => candidate.credential_id === slot.last_deployed_credential_id,
    )
  ) {
    return slot.last_deployed_credential_id
  }

  return slot.candidates.length === 1 ? slot.candidates[0]?.credential_id : undefined
}

function selectedCredentialId(
  slot: CredentialSlot,
  credentials: DeploymentConfigurationValues['credentials'],
) {
  const credentialId = credentials[credentialSlotKey(slot)] ?? defaultCredentialId(slot)
  if (!credentialId) return undefined

  return slot.candidates.some((candidate) => candidate.credential_id === credentialId)
    ? credentialId
    : undefined
}

function defaultEnvironmentVariableSelection(
  slot: EnvironmentVariableSlot,
): DeploymentConfigurationValues['environmentVariables'][string] {
  if (slot.has_configured_value) {
    return {
      customValue: '',
      source: EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED,
    }
  }

  if (slot.has_last_deployed_value) {
    return {
      customValue: '',
      source: EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED,
    }
  }

  return {
    customValue: '',
    source: EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM,
  }
}

function isEnvironmentVariableSelectionAvailable(
  slot: EnvironmentVariableSlot,
  selection: DeploymentConfigurationValues['environmentVariables'][string],
) {
  switch (selection.source) {
    case EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED:
      return slot.has_configured_value
    case EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED:
      return slot.has_last_deployed_value
    case EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM:
      return true
    default:
      return false
  }
}

export function resolveEnvironmentVariableSelection(
  slot: EnvironmentVariableSlot,
  selection?: DeploymentConfigurationValues['environmentVariables'][string],
) {
  if (selection && isEnvironmentVariableSelectionAvailable(slot, selection)) return selection

  return {
    ...defaultEnvironmentVariableSelection(slot),
    customValue: selection?.customValue ?? '',
  }
}

export function findInvalidDeploymentCredential(
  deploymentOptions: GetWorkflowDeploymentOptionsResponse,
  credentials: DeploymentConfigurationValues['credentials'],
) {
  return deploymentOptions.credential_slots.find((slot) => !selectedCredentialId(slot, credentials))
}

function selectedEnvironmentVariableValue(
  slot: EnvironmentVariableSlot,
  selection: DeploymentConfigurationValues['environmentVariables'][string],
) {
  let value: unknown

  switch (selection.source) {
    case EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CONFIGURED:
      value = slot.configured_value
      break
    case EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED:
      value = slot.last_deployed_value
      break
    case EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM:
      value = selection.customValue
      break
    default:
      return undefined
  }

  if (slot.value_type !== EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER) return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function hasValidEnvironmentVariableValue(slot: EnvironmentVariableSlot, value: unknown) {
  switch (slot.value_type) {
    case EnvVarValueType.ENV_VAR_VALUE_TYPE_LLM:
      return isLLMEnvironmentVariableValue(value)
    case EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER:
      return typeof value === 'number' && Number.isFinite(value)
    case EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET:
    case EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING:
      return typeof value === 'string' && value !== ''
    default:
      return false
  }
}

export function hasValidDeploymentEnvironmentVariables(
  deploymentOptions: GetWorkflowDeploymentOptionsResponse,
  values: DeploymentConfigurationValues,
) {
  if (
    deploymentOptions.environment_variable_groups.some(
      (group) => !group.from_app && !group.from_workflow_as_tool,
    )
  )
    return false

  return !findInvalidDeploymentEnvironmentVariable(deploymentOptions, values)
}

export function findInvalidDeploymentEnvironmentVariable(
  deploymentOptions: GetWorkflowDeploymentOptionsResponse,
  values: DeploymentConfigurationValues,
) {
  for (const group of deploymentOptions.environment_variable_groups) {
    const owner = group.from_app ?? group.from_workflow_as_tool?.workflow
    if (!owner) continue

    for (const slot of group.environment_variable_slots) {
      const selection = resolveEnvironmentVariableSelection(
        slot,
        values.environmentVariables[environmentVariableSelectionKey(owner.workflow_id, slot.key)],
      )
      const selectedValue = selectedEnvironmentVariableValue(slot, selection)
      if (!hasValidEnvironmentVariableValue(slot, selectedValue)) return { owner, slot }

      if (
        selection.source === EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM &&
        slot.value_type === EnvVarValueType.ENV_VAR_VALUE_TYPE_LLM &&
        isLLMEnvironmentVariableValue(selectedValue)
      ) {
        const requiredMode = isLLMEnvironmentVariableValue(slot.configured_value)
          ? slot.configured_value.mode
          : isLLMEnvironmentVariableValue(slot.last_deployed_value)
            ? slot.last_deployed_value.mode
            : undefined
        if (requiredMode && selectedValue.mode !== requiredMode) return { owner, slot }
      }
    }
  }

  return undefined
}

export function workflowDeploymentInput(
  deploymentOptions: GetWorkflowDeploymentOptionsResponse,
  values: DeploymentConfigurationValues,
): WorkflowDeploymentInput | undefined {
  if (!hasValidDeploymentEnvironmentVariables(deploymentOptions, values)) return

  const credentials: NonNullable<WorkflowDeploymentInput['credentials']> = []

  for (const slot of deploymentOptions.credential_slots) {
    const credentialId = selectedCredentialId(slot, values.credentials)
    if (!credentialId) return

    credentials.push({
      category: slot.category,
      credential_id: credentialId,
      provider_id: slot.provider_id,
    })
  }

  const environmentVariableGroups: WorkflowDeploymentInput['environment_variable_groups'] = []

  for (const group of deploymentOptions.environment_variable_groups) {
    const owner = group.from_app ?? group.from_workflow_as_tool?.workflow
    if (!owner) return

    environmentVariableGroups.push({
      workflow_id: owner.workflow_id,
      environment_variables: group.environment_variable_slots.map((slot) => {
        const selection = resolveEnvironmentVariableSelection(
          slot,
          values.environmentVariables[environmentVariableSelectionKey(owner.workflow_id, slot.key)],
        )
        const value = selectedEnvironmentVariableValue(slot, selection)

        return {
          key: slot.key,
          value_source: selection.source,
          ...(selection.source === EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM
            ? { value }
            : {}),
        }
      }),
    })
  }

  return {
    credentials,
    environment_variable_groups: environmentVariableGroups,
  }
}
