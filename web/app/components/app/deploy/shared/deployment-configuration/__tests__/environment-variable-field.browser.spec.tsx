import type { EnvironmentVariableSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { EnvVarValueSource, EnvVarValueType } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { EnvironmentVariableField } from '../environment-variable-field'

async function render(ui: React.ReactElement) {
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
  const { wrapper: Wrapper } = createConsoleQueryWrapper({ queryClient })
  return renderBrowser(
    <NuqsTestingAdapter>
      <Wrapper>{ui}</Wrapper>
    </NuqsTestingAdapter>,
  )
}

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
    const onChange = vi.fn()
    await render(
      <EnvironmentVariableField
        slot={llmSlot}
        workflowId="workflow-1"
        getInitialSelection={() => undefined}
        onChange={onChange}
      />,
    )

    const modelSelector = page.getByRole('button', { name: /^Chat model/ })
    await expect.element(modelSelector).toBeDisabled()
    await expect.element(page.getByText('workflow.blocks.llm')).toBeInTheDocument()

    await page.getByRole('combobox', { name: /MODEL/ }).click()
    await page
      .getByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      })
      .click()

    await page.getByRole('button', { name: 'plugin.detailPanel.configureModel' }).click()
    const picker = page.getByRole('dialog', { name: 'plugin.detailPanel.configureModel' })
    await expect
      .element(picker.getByRole('button', { name: /^Completion model/ }))
      .not.toBeInTheDocument()
    await picker.getByRole('button', { name: /^Chat model v2/ }).click()
    await page.getByRole('button', { name: /modelProvider.modelSettings/ }).click()
    await page.getByRole('switch', { name: 'Temperature' }).click()
    const temperature = page.getByRole('spinbutton', { name: 'Temperature' })
    await temperature.clear()
    await userEvent.type(temperature, '0.4')
    await userEvent.tab()

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
    await render(
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

    const modelSelector = page.getByRole('button', { name: /^Chat model/ })
    await expect.element(modelSelector).toBeDisabled()
    await expect.element(modelSelector.getByText('Chat model v2', { exact: true })).toBeVisible()
    await expect
      .element(page.getByRole('combobox', { name: /MODEL/ }))
      .toHaveTextContent('deployments.deployDrawer.envVarSource.lastDeployment')
  })
})

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})
