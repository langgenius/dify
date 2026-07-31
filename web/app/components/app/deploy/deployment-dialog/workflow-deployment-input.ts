import type {
  CredentialSlot,
  EnvironmentVariableSlot,
  GetWorkflowDeploymentOptionsResponse,
  WorkflowDeploymentInput,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValues } from './use-deployment-configuration-values'
import { EnvVarValueSource as EnvVarValueSourceEnum } from '@dify/contracts/enterprise-app-deploy/types.gen'

export function credentialSlotKey(slot: CredentialSlot) {
  return `${slot.provider_id}:${slot.category}`
}

export function defaultCredentialId(slot: CredentialSlot) {
  if (
    slot.previous_credential_id &&
    slot.candidates.some((candidate) => candidate.credential_id === slot.previous_credential_id)
  ) {
    return slot.previous_credential_id
  }

  return slot.candidates.length === 1 ? slot.candidates[0]?.credential_id : undefined
}

export function defaultEnvironmentVariableSelection(
  slot: EnvironmentVariableSlot,
): DeploymentConfigurationValues['environmentVariables'][string] {
  if (slot.has_dsl_value) {
    return {
      customValue: '',
      source: EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_DSL,
    }
  }

  if (slot.has_previous_value) {
    return {
      customValue: '',
      source: EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_PREVIOUS,
    }
  }

  return {
    customValue: '',
    source: EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM,
  }
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

  return {
    credentials,
    environment_variables: deploymentOptions.environment_variable_slots.map((slot) => {
      const selection =
        values.environmentVariables[slot.key] ?? defaultEnvironmentVariableSelection(slot)

      return {
        key: slot.key,
        value_source: selection.source,
        ...(selection.source === EnvVarValueSourceEnum.ENV_VAR_VALUE_SOURCE_CUSTOM
          ? { value: selection.customValue }
          : {}),
      }
    }),
  }
}
