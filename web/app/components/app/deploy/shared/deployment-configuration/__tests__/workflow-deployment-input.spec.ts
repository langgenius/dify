import type { GetWorkflowDeploymentOptionsResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValues } from '../use-deployment-configuration-values'
import {
  EnvVarValueSource,
  EnvVarValueType,
  PluginCategory,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { environmentVariableSelectionKey } from '../use-deployment-configuration-values'
import {
  credentialSlotKey,
  hasValidDeploymentEnvironmentVariables,
  workflowDeploymentInput,
} from '../utils/workflow-deployment-input'

const deploymentOptions: GetWorkflowDeploymentOptionsResponse = {
  credential_slots: [],
  environment_variable_groups: [
    {
      environment_variable_slots: [
        {
          description: 'Chat model used by the workflow',
          has_configured_value: false,
          has_last_deployed_value: false,
          key: 'MODEL',
          value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_LLM,
        },
      ],
      from_app: {
        app_id: 'app-1',
        icon: '🤖',
        icon_background: '#FFFFFF',
        icon_type: 'emoji',
        name: 'Primary workflow',
        workflow_id: 'workflow-1',
      },
    },
  ],
}

describe('workflowDeploymentInput', () => {
  it('keeps a custom LLM value structured inside its workflow group', () => {
    const llmValue = {
      completion_params: { temperature: 0.2 },
      mode: 'chat',
      name: 'chat-model',
      provider: 'langgenius/openai/openai',
    }
    const values: DeploymentConfigurationValues = {
      credentials: {},
      environmentVariables: {
        [environmentVariableSelectionKey('workflow-1', 'MODEL')]: {
          customValue: llmValue,
          source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
      },
    }

    expect(hasValidDeploymentEnvironmentVariables(deploymentOptions, values)).toBe(true)
    expect(workflowDeploymentInput(deploymentOptions, values)).toEqual({
      credentials: [],
      environment_variable_groups: [
        {
          environment_variables: [
            {
              key: 'MODEL',
              value: llmValue,
              value_source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
            },
          ],
          workflow_id: 'workflow-1',
        },
      ],
    })
  })

  it('rejects a custom LLM source without a selected model', () => {
    const values: DeploymentConfigurationValues = {
      credentials: {},
      environmentVariables: {
        [environmentVariableSelectionKey('workflow-1', 'MODEL')]: {
          customValue: '',
          source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
      },
    }

    expect(hasValidDeploymentEnvironmentVariables(deploymentOptions, values)).toBe(false)
    expect(workflowDeploymentInput(deploymentOptions, values)).toBeUndefined()
  })

  it.each([
    ['String', EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING],
    ['Number', EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER],
    ['Secret', EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET],
  ])('rejects an empty custom %s value', (_, valueType) => {
    const options: GetWorkflowDeploymentOptionsResponse = {
      ...deploymentOptions,
      environment_variable_groups: deploymentOptions.environment_variable_groups.map((group) => ({
        ...group,
        environment_variable_slots: group.environment_variable_slots.map((slot) => ({
          ...slot,
          key: 'VALUE',
          value_type: valueType,
        })),
      })),
    }
    const values: DeploymentConfigurationValues = {
      credentials: {},
      environmentVariables: {
        [environmentVariableSelectionKey('workflow-1', 'VALUE')]: {
          customValue: '',
          source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
      },
    }

    expect(hasValidDeploymentEnvironmentVariables(options, values)).toBe(false)
    expect(workflowDeploymentInput(options, values)).toBeUndefined()
  })

  it.each([' ', 'not-a-number', 'Infinity'])(
    'rejects an invalid custom Number value: %j',
    (customValue) => {
      const options: GetWorkflowDeploymentOptionsResponse = {
        ...deploymentOptions,
        environment_variable_groups: deploymentOptions.environment_variable_groups.map((group) => ({
          ...group,
          environment_variable_slots: group.environment_variable_slots.map((slot) => ({
            ...slot,
            key: 'PORT',
            value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER,
          })),
        })),
      }
      const values: DeploymentConfigurationValues = {
        credentials: {},
        environmentVariables: {
          [environmentVariableSelectionKey('workflow-1', 'PORT')]: {
            customValue,
            source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
          },
        },
      }

      expect(hasValidDeploymentEnvironmentVariables(options, values)).toBe(false)
      expect(workflowDeploymentInput(options, values)).toBeUndefined()
    },
  )

  it('normalizes a valid custom Number value before building the deployment payload', () => {
    const options: GetWorkflowDeploymentOptionsResponse = {
      ...deploymentOptions,
      environment_variable_groups: deploymentOptions.environment_variable_groups.map((group) => ({
        ...group,
        environment_variable_slots: group.environment_variable_slots.map((slot) => ({
          ...slot,
          key: 'PORT',
          value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER,
        })),
      })),
    }
    const values: DeploymentConfigurationValues = {
      credentials: {},
      environmentVariables: {
        [environmentVariableSelectionKey('workflow-1', 'PORT')]: {
          customValue: '3000.5',
          source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
      },
    }

    expect(workflowDeploymentInput(options, values)).toEqual({
      credentials: [],
      environment_variable_groups: [
        {
          environment_variables: [
            {
              key: 'PORT',
              value: 3000.5,
              value_source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
            },
          ],
          workflow_id: 'workflow-1',
        },
      ],
    })
  })

  it.each([
    ['configured', true, false, { configured_value: '' }],
    ['last deployed', false, true, { last_deployed_value: '' }],
  ])(
    'rejects an empty %s environment variable value',
    (_, hasConfiguredValue, hasLastDeployedValue, sourceValue) => {
      const options: GetWorkflowDeploymentOptionsResponse = {
        ...deploymentOptions,
        environment_variable_groups: deploymentOptions.environment_variable_groups.map((group) => ({
          ...group,
          environment_variable_slots: group.environment_variable_slots.map((slot) => ({
            ...slot,
            ...sourceValue,
            has_configured_value: hasConfiguredValue,
            has_last_deployed_value: hasLastDeployedValue,
            key: 'VALUE',
            value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING,
          })),
        })),
      }
      const values: DeploymentConfigurationValues = {
        credentials: {},
        environmentVariables: {},
      }

      expect(hasValidDeploymentEnvironmentVariables(options, values)).toBe(false)
      expect(workflowDeploymentInput(options, values)).toBeUndefined()
    },
  )

  it.each([
    { mode: '', name: '', provider: '' },
    { mode: 'embedding', name: 'embedding-model', provider: 'provider' },
  ])('rejects an invalid custom LLM value', (customValue) => {
    const values: DeploymentConfigurationValues = {
      credentials: {},
      environmentVariables: {
        [environmentVariableSelectionKey('workflow-1', 'MODEL')]: {
          customValue,
          source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
      },
    }

    expect(hasValidDeploymentEnvironmentVariables(deploymentOptions, values)).toBe(false)
    expect(workflowDeploymentInput(deploymentOptions, values)).toBeUndefined()
  })

  it('rejects a custom LLM value with a different mode from the configured value', () => {
    const options: GetWorkflowDeploymentOptionsResponse = {
      ...deploymentOptions,
      environment_variable_groups: deploymentOptions.environment_variable_groups.map((group) => ({
        ...group,
        environment_variable_slots: group.environment_variable_slots.map((slot) => ({
          ...slot,
          configured_value: {
            mode: 'chat',
            name: 'chat-model',
            provider: 'provider',
          },
          has_configured_value: true,
        })),
      })),
    }
    const values: DeploymentConfigurationValues = {
      credentials: {},
      environmentVariables: {
        [environmentVariableSelectionKey('workflow-1', 'MODEL')]: {
          customValue: {
            mode: 'completion',
            name: 'completion-model',
            provider: 'provider',
          },
          source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
      },
    }

    expect(hasValidDeploymentEnvironmentVariables(options, values)).toBe(false)
    expect(workflowDeploymentInput(options, values)).toBeUndefined()
  })

  it.each(['', 'removed-credential'])(
    'rejects an empty or unavailable credential selection: %j',
    (credentialId) => {
      const credentialSlot = {
        candidates: [
          {
            category: PluginCategory.PLUGIN_CATEGORY_MODEL,
            credential_id: 'credential-1',
            display_name: 'Credential 1',
            from_enterprise: false,
            provider_id: 'provider',
          },
          {
            category: PluginCategory.PLUGIN_CATEGORY_MODEL,
            credential_id: 'credential-2',
            display_name: 'Credential 2',
            from_enterprise: false,
            provider_id: 'provider',
          },
        ],
        category: PluginCategory.PLUGIN_CATEGORY_MODEL,
        provider_id: 'provider',
      }
      const options: GetWorkflowDeploymentOptionsResponse = {
        credential_slots: [credentialSlot],
        environment_variable_groups: [],
      }
      const values: DeploymentConfigurationValues = {
        credentials: { [credentialSlotKey(credentialSlot)]: credentialId },
        environmentVariables: {},
      }

      expect(workflowDeploymentInput(options, values)).toBeUndefined()
    },
  )
})
