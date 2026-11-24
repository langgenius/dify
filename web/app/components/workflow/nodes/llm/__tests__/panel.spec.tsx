import type { ReactFlowInstance } from 'reactflow'
import type { LLMNodeType } from '../types'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes, useReactFlow } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import Panel from '../panel'

const getParameterRules = vi.fn()
const rules = {
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
}
const topPRule = {
  name: 'top_p',
  label: { en_US: 'Top P' },
  type: 'float',
  min: 0,
  max: 1,
}

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': (input) =>
        getParameterRules(input),
    }),
  }
})
vi.mock('@/app/notifications', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))

const createData = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: { temperature: 0.7 },
  },
  prompt_template: [],
  context: { enabled: false, variable_selector: [] },
  vision: { enabled: false },
  ...overrides,
})
const sharedModel: EnvironmentVariable = {
  id: 'env-llm',
  name: 'for_summarize',
  value_type: 'llm',
  description: '',
  value: { provider: 'anthropic', name: 'claude-3-5-sonnet', mode: 'chat' },
}

const renderPanel = ({
  data = createData(),
  resource = { kind: 'app', collaborationEnabled: false, appId: 'test-app', mode: 'workflow' },
  environmentVariables = [sharedModel],
}: {
  data?: LLMNodeType
  resource?: EditorResource
  environmentVariables?: EnvironmentVariable[]
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-4o',
          label: { en_US: 'GPT-4o' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
    createModelCatalogFixture({
      provider: 'anthropic',
      label: { en_US: 'Anthropic' },
      models: [
        createCatalogModelFixture({
          model: 'claude-3-5-sonnet',
          label: { en_US: 'Claude 3.5 Sonnet' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: rules },
  )
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  let flow: ReactFlowInstance<LLMNodeType>
  function NodePanel() {
    flow = useReactFlow<LLMNodeType>()
    const node = useNodes<LLMNodeType>().find((node) => node.id === 'llm-node')
    if (!node) return null
    return (
      <Panel
        id={node.id}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
      />
    )
  }
  const render = createNuqsTestRenderer((ui) =>
    renderWorkflowFlowComponent(<EventEmitterContextProvider>{ui}</EventEmitterContextProvider>, {
      queryClient,
      resource,
      nodes: [createNode({ id: 'llm-node', data })],
      initialStoreState: { environmentVariables },
    }),
  )
  return { ...render(<NodePanel />), getNodeData: () => flow.getNode('llm-node')!.data }
}

const chooseDirectModel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /^GPT-4o/ }))
  const picker = within(
    await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
  )
  await user.click(picker.getByRole('button', { name: /^Claude 3.5 Sonnet/ }))
  await waitFor(() =>
    expect(getParameterRules).toHaveBeenCalledWith(
      expect.objectContaining({ query: { model: 'claude-3-5-sonnet' } }),
    ),
  )
}
const chooseEnvironmentModel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('combobox', { name: 'workflowModels.nodes.llm.model' }))
  await user.click(await screen.findByRole('option', { name: 'for_summarize' }))
  await waitFor(() => expect(getParameterRules).toHaveBeenCalledOnce())
}

beforeEach(() => {
  getParameterRules.mockReset().mockResolvedValue(rules)
})

describe('LLM Panel', () => {
  it('offers model selection and disables parameter settings for an unconfigured model', async () => {
    renderPanel({
      data: createData({ model: { provider: '', name: '', mode: 'chat', completion_params: {} } }),
    })
    expect(
      await screen.findByRole('button', { name: 'plugin.detailPanel.configureModel' }),
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: /modelProvider.modelSettings/ })).toBeDisabled()
  })

  it('switches from direct input to an environment model reference', async () => {
    const user = userEvent.setup()
    const { getNodeData } = renderPanel()
    await user.click(
      await screen.findByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    )
    expect(
      screen.getByRole('combobox', { name: 'workflowModels.nodes.llm.model' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })).toBeDisabled()
    expect(getNodeData().model_selector).toEqual([])
  })

  it('does not offer an environment model source in snippet flows', async () => {
    renderPanel({ resource: { kind: 'snippet', snippetId: 'test-snippet' } })
    expect(await screen.findByRole('button', { name: /^GPT-4o/ })).toBeEnabled()
    expect(
      screen.queryByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: 'workflow.nodes.common.typeSwitch.input' }),
    ).not.toBeInTheDocument()
  })

  it('recovers a pasted environment-bound snippet node to a direct model', async () => {
    const user = userEvent.setup()
    const { getNodeData } = renderPanel({
      data: createData({ model_selector: ['env', 'missing_model'] }),
      resource: { kind: 'snippet', snippetId: 'test-snippet' },
      environmentVariables: [],
    })
    await user.click(
      await screen.findByRole('radio', { name: 'workflow.nodes.common.typeSwitch.input' }),
    )
    expect(screen.getByRole('button', { name: /^GPT-4o/ })).toBeEnabled()
    expect(getNodeData().model_selector).toBeUndefined()
  })

  it('lists only LLM environment variables and binds the selected reference', async () => {
    const user = userEvent.setup()
    const { getNodeData } = renderPanel({
      data: createData({ model_selector: [] }),
      environmentVariables: [
        sharedModel,
        {
          id: 'env-string',
          name: 'API_KEY',
          value_type: 'string',
          value: 'secret',
          description: '',
        },
      ],
    })
    await user.click(
      await screen.findByRole('combobox', { name: 'workflowModels.nodes.llm.model' }),
    )
    expect(screen.queryByRole('option', { name: 'API_KEY' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'for_summarize' }))
    expect(await screen.findByRole('button', { name: /^Claude 3.5 Sonnet/ })).toBeDisabled()
    expect(getNodeData().model_selector).toEqual(['env', 'for_summarize'])
    expect(getNodeData().model.completion_params).toEqual({ temperature: 0.7 })
  })

  it('ignores a pending environment model selection after returning to direct input', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<typeof rules>()
    getParameterRules.mockReturnValueOnce(pending.promise)
    const { getNodeData } = renderPanel({ data: createData({ model_selector: [] }) })
    await chooseEnvironmentModel(user)
    await user.click(screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.input' }))
    await act(async () => {
      pending.resolve(rules)
      await pending.promise
    })
    expect(screen.getByRole('button', { name: /^GPT-4o/ })).toBeEnabled()
    expect(getNodeData().model_selector).toBeUndefined()
    expect(getNodeData().model).toEqual(createData().model)
  })

  it('ignores a pending selection when the target environment model changes', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<typeof rules>()
    getParameterRules.mockReturnValueOnce(pending.promise)
    const { getNodeData, store } = renderPanel({ data: createData({ model_selector: [] }) })
    await chooseEnvironmentModel(user)
    act(() => {
      store.getState().setEnvironmentVariables([
        {
          ...sharedModel,
          value: { provider: 'openai', name: 'gpt-4o', mode: 'chat' },
        },
      ])
    })
    await act(async () => {
      pending.resolve(rules)
      await pending.promise
    })
    expect(getNodeData().model_selector).toEqual([])
    expect(getNodeData().model).toEqual(createData().model)
  })

  it('preserves parameter edits made while checking the previous model rules', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<typeof rules>()
    getParameterRules
      .mockResolvedValueOnce({ data: [topPRule] })
      .mockReturnValueOnce(pending.promise)
    const { getNodeData } = renderPanel()
    await chooseDirectModel(user)
    await waitFor(() =>
      expect(getParameterRules).toHaveBeenCalledWith(
        expect.objectContaining({ query: { model: 'gpt-4o' } }),
      ),
    )
    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' })
    await user.clear(temperature)
    await user.type(temperature, '0.9')
    await user.tab()
    await user.keyboard('{Escape}')
    await act(async () => {
      pending.resolve(rules)
      await pending.promise
    })
    expect(screen.getByRole('button', { name: /^GPT-4o/ })).toBeEnabled()
    expect(getNodeData().model).toEqual({
      ...createData().model,
      completion_params: { temperature: 0.9 },
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('warns when switching removes a parameter enabled in settings', async () => {
    const user = userEvent.setup()
    const targetRules = { data: [topPRule] }
    const pending = createDeferred<typeof targetRules>()
    getParameterRules.mockReturnValueOnce(pending.promise)
    const data = createData()
    data.model.completion_params = { top_p: 0.9 }
    const { getNodeData } = renderPanel({ data })

    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    const temperatureSwitch = screen.getByRole('switch', { name: 'Temperature' })
    expect(temperatureSwitch).not.toBeChecked()
    await user.click(temperatureSwitch)
    expect(temperatureSwitch).toBeChecked()
    expect(getNodeData().model.completion_params).toEqual({ top_p: 0.9, temperature: 0.7 })
    await user.keyboard('{Escape}')

    await chooseDirectModel(user)
    expect(getNodeData().model.name).toBe('gpt-4o')
    await act(async () => {
      pending.resolve(targetRules)
      await pending.promise
    })
    expect(screen.getByRole('button', { name: /^Claude 3.5 Sonnet/ })).toBeEnabled()
    expect(getNodeData().model).toEqual({
      provider: 'anthropic',
      name: 'claude-3-5-sonnet',
      mode: 'chat',
      completion_params: { top_p: 0.9 },
    })
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      'modelProvider.modelProvider.parametersInvalidRemoved:{"parameters":"temperature"}',
    )
  })

  it('silently removes a legacy parameter unsupported by both models', async () => {
    const user = userEvent.setup()
    getParameterRules.mockResolvedValue({ data: [topPRule] })
    const { getNodeData } = renderPanel()

    await chooseDirectModel(user)

    expect(await screen.findByRole('button', { name: /^Claude 3.5 Sonnet/ })).toBeEnabled()
    expect(getNodeData().model.completion_params).toEqual({})
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('preserves the current model and parameters when the rules request fails', async () => {
    const user = userEvent.setup()
    getParameterRules.mockRejectedValueOnce(new Error('network error'))
    const { getNodeData } = renderPanel()
    await chooseDirectModel(user)
    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('network error'))
    expect(screen.getByRole('button', { name: /^GPT-4o/ })).toBeEnabled()
    expect(getNodeData().model).toEqual(createData().model)
  })
})
