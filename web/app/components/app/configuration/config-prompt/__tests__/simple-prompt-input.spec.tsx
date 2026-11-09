import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ConfigVar from '@/app/components/app/configuration/config-var'
import { toast } from '@/app/components/app/configuration/toast'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import ConfigContext from '@/context/debug-configuration'
import { consoleQuery } from '@/service/console'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient } from '@/test/console/query-data'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import Prompt from '../simple-prompt-input'

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'ruleGenerate.post': generate,
    }),
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({}),
}))
const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
const existingVariable: PromptVariable = {
  key: 'existing_var',
  name: 'Existing',
  type: 'string',
  required: true,
}

function renderPrompt({
  promptTemplate = 'Hello {{new_var}}',
  promptVariables = [existingVariable],
  externalDataToolsConfig = [],
}: {
  promptTemplate?: string
  promptVariables?: PromptVariable[]
  externalDataToolsConfig?: ExternalDataTool[]
} = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({ model: 'gpt-4o-mini', model_properties: { mode: 'chat' } }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture({ model: 'gpt-4o-mini' }) },
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  queryClient.setQueryData(
    consoleQuery.codeBasedExtension.get.queryKey({
      input: { query: { module: 'external_data_tool' } },
    }),
    { module: 'external_data_tool', data: [] },
  )
  queryClient.setQueryData(consoleQuery.apiBasedExtension.get.queryKey(), [
    {
      id: 'extension-1',
      name: 'Search API',
      api_endpoint: 'https://example.com/search',
      api_key: 'secret',
    },
  ])
  const onChange = vi.fn()
  function ControlledPrompt() {
    const [modelConfig, setModelConfig] = useState(() =>
      createModelConfigFixture({
        configs: { prompt_template: promptTemplate, prompt_variables: promptVariables },
      }),
    )
    return (
      <ConfigContext.Provider
        value={createDebugConfigurationFixture({
          appId: 'app-1',
          modelConfig,
          setModelConfig,
          externalDataToolsConfig,
        })}
      >
        <Prompt
          mode="chat"
          promptTemplate={modelConfig.configs.prompt_template}
          promptVariables={modelConfig.configs.prompt_variables}
          onChange={onChange}
        />
        <ConfigVar promptVariables={modelConfig.configs.prompt_variables} readonly />
      </ConfigContext.Provider>
    )
  }
  return { ...renderWithConfigurationModals(<ControlledPrompt />, { queryClient }), onChange }
}
const blurPrompt = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('textbox'))
  await user.tab()
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.removeItem('auto-gen-model')
  generate.mockResolvedValue({
    prompt: 'auto prompt',
    variables: ['city'],
    opening_statement: 'hello there',
  })
})

it('offers discovered variables and passes the accepted variables to the caller', async () => {
  const user = userEvent.setup()
  const { onChange } = renderPrompt()
  await blurPrompt(user)
  expect(screen.getByText(/(?:^|\.)autoAddVar(?=$|:)/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  expect(onChange).toHaveBeenLastCalledWith('Hello {{new_var}}', [
    expect.objectContaining({ key: 'new_var', name: 'new_var' }),
  ])
  expect(screen.queryByText(/(?:^|\.)autoAddVar(?=$|:)/)).not.toBeInTheDocument()
})

it('validates an external tool in the real modal and inserts the saved variable into the editor', async () => {
  const user = userEvent.setup()
  renderPrompt({ promptTemplate: 'Hello' })
  await user.click(screen.getByRole('textbox'))
  await replacePromptEditorText(screen.getByRole('textbox'), '/')
  await user.click(
    await screen.findByRole('option', { name: 'common.promptEditor.variable.modal.addTool' }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'),
    'Search',
  )
  const variableName = within(dialog).getByPlaceholderText(
    'appDebug.feature.tools.modal.variableName.placeholder',
  )
  await user.type(variableName, 'existing_var')
  await user.click(
    within(dialog).getByRole('button', { name: 'common.apiBasedExtension.selector.placeholder' }),
  )
  await user.click(await screen.findByRole('button', { name: /Search API/ }))
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  expect(toastErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining('varKeyError.keyAlreadyExists'),
  )
  expect(dialog).toBeInTheDocument()
  await user.clear(variableName)
  await user.type(variableName, 'search_api')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('search_api'))
})

it('applies generated prompt, variables and opening statement after confirming the real result', async () => {
  const user = userEvent.setup()
  const { featuresStore } = renderPrompt({ promptTemplate: 'Hello' })
  await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))
  const dialog = await screen.findByRole('dialog', { name: 'appGeneration.generate.title' })
  await replacePromptEditorText(
    within(dialog).getByRole('textbox', { name: 'appGeneration.generate.instruction' }),
    'Help plan a city trip',
  )
  await user.click(within(dialog).getByRole('button', { name: 'appGeneration.generate.generate' }))
  await user.click(
    await within(dialog).findByRole('button', { name: 'appGeneration.generate.apply' }),
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.confirm',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('textbox')).toHaveTextContent('auto prompt')
  expect(screen.getByTitle('city · city')).toBeInTheDocument()
  expect(screen.queryByText('existing_var', { exact: true })).not.toBeInTheDocument()
  expect(featuresStore.getState().features.opening).toEqual({
    enabled: true,
    opening_statement: 'hello there',
  })
  expect(generate).toHaveBeenCalledExactlyOnceWith({
    body: {
      instruction: 'Help plan a city trip',
      no_variable: false,
      model_config: {
        name: 'gpt-4o-mini',
        provider: 'openai',
        mode: 'chat',
        completion_params: {},
      },
    },
  })
})

it('does not prompt for known tools or existing variables', async () => {
  const user = userEvent.setup()
  const { onChange } = renderPrompt({
    promptTemplate: 'Hello {{search_api}} {{existing_var}}',
    externalDataToolsConfig: [{ variable: 'search_api' }],
  })
  await blurPrompt(user)
  expect(onChange).toHaveBeenLastCalledWith('Hello {{search_api}} {{existing_var}}', [])
  expect(screen.queryByText(/(?:^|\.)autoAddVar(?=$|:)/)).not.toBeInTheDocument()
})

it('lets the user decline adding an incomplete variable definition', async () => {
  const user = userEvent.setup()
  const { onChange } = renderPrompt({
    promptTemplate: 'Hello {{existing_var}}',
    promptVariables: [{ ...existingVariable, name: '' }],
  })
  await blurPrompt(user)
  expect(screen.getByText(/(?:^|\.)autoAddVar(?=$|:)/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(onChange).toHaveBeenLastCalledWith('Hello {{existing_var}}', [])
  expect(screen.queryByText(/(?:^|\.)autoAddVar(?=$|:)/)).not.toBeInTheDocument()
})
