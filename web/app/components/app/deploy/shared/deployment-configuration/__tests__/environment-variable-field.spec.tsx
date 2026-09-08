import type { EnvironmentVariableSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { EnvVarValueSource, EnvVarValueType } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EnvironmentVariableField } from '../environment-variable-field'

const activeModelList = vi.hoisted(() => [
  {
    label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
    models: [
      {
        deprecated: false,
        has_invalid_load_balancing_configs: false,
        label: { en_US: 'Chat model', zh_Hans: 'Chat model' },
        load_balancing_enabled: false,
        model: 'chat-model',
        model_properties: { mode: 'chat' },
        model_type: 'llm',
        status: 'active',
      },
      {
        deprecated: false,
        has_invalid_load_balancing_configs: false,
        label: { en_US: 'Chat model v2', zh_Hans: 'Chat model v2' },
        load_balancing_enabled: false,
        model: 'chat-model-v2',
        model_properties: { mode: 'chat' },
        model_type: 'llm',
        status: 'active',
      },
      {
        deprecated: false,
        has_invalid_load_balancing_configs: false,
        label: { en_US: 'Completion model', zh_Hans: 'Completion model' },
        load_balancing_enabled: false,
        model: 'completion-model',
        model_properties: { mode: 'completion' },
        model_type: 'llm',
        status: 'active',
      },
    ],
    provider: 'langgenius/openai/openai',
  },
])

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    activeTextGenerationModelList: activeModelList,
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: ({
      completionParams,
      modelId,
      modelList = [],
      modelSelectorReadonly,
      provider,
      readonly,
      onCompletionParamsChange,
      setModel,
    }: ModelParameterModalProps) => {
      const selectableModels = modelList.flatMap((providerItem) =>
        providerItem.models.map((model) => ({ model, provider: providerItem.provider })),
      )
      const nextModel = selectableModels.find(({ model }) => model.model === 'chat-model-v2')

      return (
        <div>
          <button
            type="button"
            aria-label="Select deployment model"
            disabled={readonly || modelSelectorReadonly}
            onClick={() => {
              if (!nextModel) return

              setModel({
                modelId: nextModel.model.model,
                mode: nextModel.model.model_properties.mode as string,
                provider: nextModel.provider,
              })
            }}
          >
            {provider && modelId ? `${provider}/${modelId}` : 'No model selected'}
          </button>
          <button
            type="button"
            onClick={() => onCompletionParamsChange({ ...completionParams, temperature: 0.4 })}
          >
            Set temperature
          </button>
          {selectableModels.map(({ model }) => (
            <span key={model.model}>{model.model}</span>
          ))}
        </div>
      )
    },
  }),
)

const llmSlot: EnvironmentVariableSlot = {
  configured_value: {
    completion_params: { temperature: 0.2 },
    mode: 'chat',
    name: 'chat-model',
    provider: 'langgenius/openai/openai',
  },
  description: 'Chat model used by the workflow',
  has_configured_value: true,
  has_last_deployed_value: false,
  key: 'MODEL',
  value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_LLM,
}

describe('EnvironmentVariableField', () => {
  it('selects a compatible custom LLM and keeps its parameters structured', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <EnvironmentVariableField
        slot={llmSlot}
        workflowId="workflow-1"
        getInitialSelection={() => undefined}
        onChange={onChange}
      />,
    )

    const modelSelector = await screen.findByRole('button', { name: 'Select deployment model' })
    expect(modelSelector).toBeDisabled()
    expect(modelSelector).toHaveTextContent('langgenius/openai/openai/chat-model')
    expect(screen.getByText('workflow.blocks.llm')).toBeInTheDocument()
    expect(screen.getByText('chat-model-v2')).toBeInTheDocument()
    expect(screen.queryByText('completion-model')).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /MODEL/ }))
    await user.click(
      await screen.findByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    )

    expect(modelSelector).toBeEnabled()
    await user.click(modelSelector)
    await user.click(screen.getByRole('button', { name: 'Set temperature' }))

    expect(onChange).toHaveBeenLastCalledWith('workflow-1', 'MODEL', {
      customValue: {
        completion_params: { temperature: 0.4 },
        mode: 'chat',
        name: 'chat-model-v2',
        provider: 'langgenius/openai/openai',
      },
      source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
    })
  })

  it('shows the last deployed LLM as a read-only source', async () => {
    render(
      <EnvironmentVariableField
        slot={{
          ...llmSlot,
          configured_value: undefined,
          has_configured_value: false,
          has_last_deployed_value: true,
          last_deployed_value: {
            completion_params: {},
            mode: 'chat',
            name: 'chat-model-v2',
            provider: 'langgenius/openai/openai',
          },
        }}
        workflowId="workflow-1"
        getInitialSelection={() => undefined}
        onChange={vi.fn()}
      />,
    )

    const modelSelector = await screen.findByRole('button', { name: 'Select deployment model' })
    expect(modelSelector).toBeDisabled()
    expect(modelSelector).toHaveTextContent('langgenius/openai/openai/chat-model-v2')
    expect(screen.getByRole('combobox', { name: /MODEL/ })).toHaveTextContent(
      'deployments.deployDrawer.envVarSource.lastDeployment',
    )
  })
})
