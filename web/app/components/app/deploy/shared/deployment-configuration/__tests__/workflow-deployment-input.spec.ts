import type { GetWorkflowDeploymentOptionsResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValues } from '../use-deployment-configuration-values'
import { EnvVarValueSource, EnvVarValueType } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { environmentVariableSelectionKey } from '../use-deployment-configuration-values'
import {
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
})
