import type { EnvironmentVariableSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { EnvVarValueSource, EnvVarValueType } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { EnvironmentVariableField } from '../environment-variable-field'

const render = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider: 'langgenius/openai/openai',
      models: [
        createCatalogModelFixture({
          model: 'chat-model',
          label: { en_US: 'Chat model' },
          model_properties: { mode: 'chat' },
        }),
        createCatalogModelFixture({
          model: 'chat-model-v2',
          label: { en_US: 'Chat model v2' },
          model_properties: { mode: 'chat' },
        }),
        createCatalogModelFixture({
          model: 'completion-model',
          label: { en_US: 'Completion model' },
          model_properties: { mode: 'completion' },
        }),
      ],
    }),
  ])
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    {
      initialData: {
        data: [
          {
            name: 'temperature',
            label: { en_US: 'Temperature' },
            type: 'float',
            default: 0.7,
            min: 0,
            max: 2,
          },
        ],
      },
    },
  )
  return renderWithConsoleQuery(ui, { queryClient })
})

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
  beforeAll(async () => {
    // Load the production chunk before testing the lazy field's interactions.
    await import('@/app/components/workflow/llm-environment-variable-value-field')
  })
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

    const modelSelector = await screen.findByRole('button', { name: /^Chat model/ })
    expect(modelSelector).toBeDisabled()
    expect(screen.getByText('workflow.blocks.llm')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /MODEL/ }))
    await user.click(
      await screen.findByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    const picker = within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    )
    expect(picker.queryByRole('button', { name: /^Completion model/ })).not.toBeInTheDocument()
    await user.click(picker.getByRole('button', { name: /^Chat model v2/ }))
    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' })
    await user.clear(temperature)
    await user.type(temperature, '0.4')
    await user.tab()

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

    const modelSelector = await screen.findByRole('button', { name: /^Chat model/ })
    expect(modelSelector).toBeDisabled()
    expect(modelSelector).toHaveTextContent('Chat model v2')
    expect(screen.getByRole('combobox', { name: /MODEL/ })).toHaveTextContent(
      'deployments.deployDrawer.envVarSource.lastDeployment',
    )
  })
})
