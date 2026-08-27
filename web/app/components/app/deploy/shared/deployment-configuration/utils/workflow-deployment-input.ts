import type {
  CredentialSlot,
  EnvironmentVariableSlot,
  GetWorkflowDeploymentOptionsResponse,
  WorkflowDeploymentInput,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValues } from '../use-deployment-configuration-values'
import { EnvVarValueSource as EnvVarValueSourceEnum } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { environmentVariableSelectionKey } from '../use-deployment-configuration-values'

export function credentialSlotKey(slot: CredentialSlot) {
  return `${slot.provider_id}:${slot.category}`
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

export function hasRequiredDeploymentCredentials(
  deploymentOptions: GetWorkflowDeploymentOptionsResponse,
  credentials: DeploymentConfigurationValues['credentials'],
) {
  return deploymentOptions.credential_slots.every((slot) =>
    Boolean(credentials[credentialSlotKey(slot)] ?? defaultCredentialId(slot)),
  )
}

export function workflowDeploymentInput(
  deploymentOptions: GetWorkflowDeploymentOptionsResponse,
  values: DeploymentConfigurationValues,
): WorkflowDeploymentInput | undefined {
  const credentials: NonNullable<WorkflowDeploymentInput['credentials']> = []

  for (const slot of deploymentOptions.credential_slots) {
    const credentialId = values.credentials[credentialSlotKey(slot)] ?? defaultCredentialId(slot)
    if (!credentialId) return

    credentials.push({
      category: slot.category,
      credential_id: credentialId,
      provider_id: slot.provider_id,
    })
  }

  const environmentVariableGroups: WorkflowDeploymentInput['environment_variable_groups'] = []

  for (const group of deploymentOptions.environment_variable_groups) {
    const owner = group.from_app ?? group.from_workflow_as_tool
    if (!owner) return

    environmentVariableGroups.push({
      workflow_id: owner.workflow_id,
      environment_variables: group.environment_variable_slots.map((slot) => {
        const selection = resolveEnvironmentVariableSelection(
          slot,
          values.environmentVariables[environmentVariableSelectionKey(owner.workflow_id, slot.key)],
        )

        return {
          key: slot.key,
          value_source: selection.source,
          ...(selection.source === EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM
            ? { value: selection.customValue }
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
