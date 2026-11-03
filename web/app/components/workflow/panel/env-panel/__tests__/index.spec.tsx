import type { ReactFlowInstance } from 'reactflow'
import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable, Node } from '@/app/components/workflow/types'
import type { consoleClient } from '@/service/console'
import { zGetWorkspacesCurrentModelProvidersByProviderModelsParameterRulesResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { isLLMEnvironmentVariableValue } from '@/app/components/workflow/llm-environment-variable'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import EnvPanel from '../index'

const createLLMNode = ({
  id = 'llm-node',
  data,
}: {
  id?: string
  data: Partial<LLMNodeType>
}): Node<LLMNodeType> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.LLM,
    title: 'LLM',
    desc: '',
    model: { provider: 'old-provider', name: 'old-model', mode: 'chat', completion_params: {} },
    context: { enabled: false, variable_selector: [] },
    prompt_template: [],
    vision: { enabled: false },
    ...data,
  },
})

const createCodeNode = (
  id: string,
  variables: CodeNodeType['variables'] = [],
): Node<CodeNodeType> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Code,
    title: id,
    desc: '',
    code: '',
    code_language: CodeLanguage.python3,
    outputs: {},
    variables,
  },
})

const {
  mockDoSyncWorkflowDraft,
  mockUpdateEnvironmentVariables,
  mockFetchWorkflowDraft,
  mockGetSocket,
  mockFetchModelParameterRulesForModel,
} = vi.hoisted(() => ({
  mockDoSyncWorkflowDraft: vi.fn<
    (
      notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: {
        environmentVariablePatch?: {
          environmentVariables: EnvironmentVariable[]
          deletedEnvironmentVariableIds: string[]
        }
      },
    ) => Promise<void>
  >(),
  mockUpdateEnvironmentVariables:
    vi.fn<
      (payload: {
        appId: string
        environmentVariables: EnvironmentVariable[]
        deletedEnvironmentVariableIds: string[]
      }) => Promise<unknown>
    >(),
  mockFetchWorkflowDraft: vi.fn<() => Promise<{ environment_variables: EnvironmentVariable[] }>>(),
  mockGetSocket:
    vi.fn<(appId: string) => { emit: (event: string, payload: unknown) => void } | null>(),
  mockFetchModelParameterRulesForModel:
    vi.fn<(provider: string, modelId: string) => Promise<ModelParameterRule[]>>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  const readDraft = async () => createWorkflowResponseFixture(await mockFetchWorkflowDraft())
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.get': readDraft,
      'rag.pipelines.byPipelineId.workflows.draft.get': readDraft,
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': async ({
        params,
        query,
      }: Parameters<
        typeof consoleClient.workspaces.current.modelProviders.byProvider.models.parameterRules.get
      >[0]) =>
        zGetWorkspacesCurrentModelProvidersByProviderModelsParameterRulesResponse.parse({
          data: await mockFetchModelParameterRulesForModel(params.provider, query.model),
        }),
    }),
  }
})

vi.mock('@/service/workflow', () => ({
  updateEnvironmentVariables: (payload: {
    appId: string
    environmentVariables: EnvironmentVariable[]
    deletedEnvironmentVariableIds: string[]
  }) => mockUpdateEnvironmentVariables(payload),
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: (appId: string) => mockGetSocket(appId),
  },
}))

const createEnv = (overrides: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id: 'env-1',
  name: 'api_key',
  value: '[__HIDDEN__]',
  value_type: 'secret',
  description: 'secret description',
  ...overrides,
})

const oldModelEnv = (overrides: Partial<EnvironmentVariable> = {}) =>
  createEnv({
    name: 'shared_model',
    value_type: 'llm',
    value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    description: '',
    ...overrides,
  })

const modelRule: ModelParameterRule = {
  name: 'temperature',
  type: 'float',
  min: 0,
  max: 2,
  label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
  required: false,
}

type RenderPanelOptions = {
  initialStoreState?: Partial<Shape>
  nodes?: Node[]
  resource?: EditorResource
}

const renderPanelWithNuqs = createNuqsTestRenderer(
  (
    ui,
    {
      initialStoreState = {},
      nodes = [],
      resource = { kind: 'app', appId: 'app-1', mode: 'workflow' },
    }: RenderPanelOptions = {},
  ) => {
    const { queryClient } = createConsoleQueryWrapper({
      systemFeatures: { enable_collaboration_mode: false },
    })
    seedModelProviderQueries(queryClient, [
      createModelCatalogFixture({
        provider: 'old-provider',
        models: [
          createCatalogModelFixture({
            model: 'old-model',
            label: { en_US: 'old-model' },
            model_properties: { mode: 'chat' },
          }),
        ],
      }),
      createModelCatalogFixture({
        provider: 'new-provider',
        models: [
          createCatalogModelFixture({
            model: 'new-model',
            label: { en_US: 'new-model' },
            model_properties: { mode: 'chat' },
            features: [],
          }),
          createCatalogModelFixture({
            model: 'newest-model',
            label: { en_US: 'newest-model' },
            model_properties: { mode: 'chat' },
            features: [],
          }),
        ],
      }),
    ])
    queryClient.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
      { initialData: { data: [modelRule] } },
    )
    let flow: ReactFlowInstance | undefined
    const result = renderWorkflowFlowComponent(ui, {
      resource,
      queryClient,
      nodes,
      initialStoreState,
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSyncWorkflowDraft },
      reactFlowProps: {
        nodeTypes: { custom: () => null },
        onInit: (instance) => {
          flow = instance
        },
      },
    })

    return {
      ...result,
      getNodes: () => {
        if (!flow) throw new Error('React Flow was not initialized')
        return flow.getNodes()
      },
    }
  },
)

function renderPanel(options: RenderPanelOptions = {}) {
  return renderPanelWithNuqs(<EnvPanel />, options)
}

async function openCreateVariable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelButton' }))
  await screen.findByRole('textbox', { name: 'workflow.env.modal.name' })
}

async function openEditVariable(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `common.operation.edit ${name}` }))
  await screen.findByRole('textbox', { name: 'workflow.env.modal.name' })
}

async function setTextField(name: string, value: string, user: ReturnType<typeof userEvent.setup>) {
  const field = screen.getByRole('textbox', { name })
  await user.clear(field)
  if (value) await user.type(field, value)
}

async function selectModel(
  user: ReturnType<typeof userEvent.setup>,
  currentModel: string | undefined,
  nextModel: string,
) {
  await user.click(
    screen.getByRole('button', {
      name: currentModel ? new RegExp(`^${currentModel}`) : 'plugin.detailPanel.configureModel',
    }),
  )
  const picker = within(
    await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
  )
  await user.click(picker.getByRole('button', { name: new RegExp(`^${nextModel}`) }))
}

async function saveForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', { name: 'workflow.env.modal.name' }),
    ).not.toBeInTheDocument(),
  )
}

async function createTextVariable(
  user: ReturnType<typeof userEvent.setup>,
  { name, value, description = '' }: { name: string; value: string; description?: string },
) {
  await openCreateVariable(user)
  await user.type(screen.getByRole('textbox', { name: 'workflow.env.modal.name' }), name)
  await user.type(screen.getByRole('textbox', { name: 'workflow.env.modal.value' }), value)
  if (description)
    await user.type(
      screen.getByRole('textbox', { name: 'workflow.env.modal.description' }),
      description,
    )
  await saveForm(user)
}

async function createSecretVariable(
  user: ReturnType<typeof userEvent.setup>,
  { name, value }: { name: string; value: string },
) {
  await openCreateVariable(user)
  await user.click(screen.getByRole('button', { name: 'Secret', pressed: false }))
  await user.type(screen.getByRole('textbox', { name: 'workflow.env.modal.name' }), name)
  await user.type(screen.getByRole('textbox', { name: 'workflow.env.modal.value' }), value)
  await saveForm(user)
}

async function changeExistingModel(
  user: ReturnType<typeof userEvent.setup>,
  envName: string,
  currentModel = 'old-model',
  nextModel = 'new-model',
) {
  await openEditVariable(user, envName)
  await selectModel(user, currentModel, nextModel)
  await saveForm(user)
}

describe('EnvPanel container', () => {
  beforeEach(() => {
    mockDoSyncWorkflowDraft.mockReset()
    mockUpdateEnvironmentVariables.mockReset()
    mockFetchWorkflowDraft.mockReset()
    mockFetchModelParameterRulesForModel.mockReset()
    mockGetSocket.mockReset()
    mockDoSyncWorkflowDraft.mockImplementation(async (_notRefresh, callback) => {
      callback?.onSuccess?.()
    })
    mockUpdateEnvironmentVariables.mockResolvedValue({})
    mockFetchWorkflowDraft.mockRejectedValue(new Error('draft refresh unavailable'))
    mockFetchModelParameterRulesForModel.mockResolvedValue([])
    mockGetSocket.mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds a plain variable through the environment API', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [], envSecrets: {} },
    })

    await createTextVariable(user, {
      name: 'created_name',
      value: 'created-value',
      description: 'created',
    })

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          name: 'created_name',
          value: 'created-value',
          description: 'created',
        }),
      ]),
    )
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [expect.objectContaining({ name: 'created_name' })],
      deletedEnvironmentVariableIds: [],
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('persists new pipeline variables through draft sync without app requests or socket events', async () => {
    const user = userEvent.setup()
    const existingEnv = createEnv({
      name: 'existing_variable',
      value_type: 'string',
      value: 'existing',
    })
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })
    let completeSync!: () => void
    let variablesSentToDraft: EnvironmentVariable[] = []
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [existingEnv], envSecrets: {} },
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    })
    mockDoSyncWorkflowDraft.mockImplementationOnce((_notRefresh, callback) => {
      variablesSentToDraft = store.getState().environmentVariables
      return new Promise((resolve) => {
        completeSync = () => {
          callback?.onSuccess?.()
          resolve()
        }
      })
    })

    await createTextVariable(user, { name: 'created_name', value: 'created-value' })
    expect(variablesSentToDraft).toEqual([
      expect.objectContaining({ name: 'created_name', value: 'created-value' }),
      existingEnv,
    ])
    await act(async () => completeSync())

    expect(await screen.findByText('created_name')).toBeInTheDocument()
    expect(screen.getByText('existing_variable')).toBeInTheDocument()
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockGetSocket).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('restores persisted pipeline variables after draft sync fails', async () => {
    const user = userEvent.setup()
    const existingEnv = createEnv({
      name: 'existing_variable',
      value_type: 'string',
      value: 'existing',
    })
    const untouchedEnv = createEnv({
      id: 'env-untouched',
      name: 'untouched_variable',
      value_type: 'string',
      value: 'untouched',
    })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [existingEnv, untouchedEnv] })
    mockDoSyncWorkflowDraft.mockImplementation(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    renderPanel({
      initialStoreState: {
        environmentVariables: [existingEnv, untouchedEnv],
        envSecrets: {},
      },
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    })

    await openEditVariable(user, existingEnv.name)
    await setTextField('workflow.env.modal.name', 'rejected_name', user)
    await saveForm(user)

    expect(
      await screen.findByRole('button', { name: 'common.operation.edit existing_variable' }),
    ).toBeInTheDocument()
    expect(screen.getByText('untouched_variable')).toBeInTheDocument()
    expect(mockFetchWorkflowDraft).toHaveBeenCalled()
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockGetSocket).not.toHaveBeenCalled()
  })

  it('deletes unused variables through the environment API', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await user.click(screen.getByRole('button', { name: `common.operation.delete ${env.name}` }))

    await waitFor(() => expect(store.getState().environmentVariables).toEqual([]))
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [],
      deletedEnvironmentVariableIds: [env.id],
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('adds secret variables and stores only masked values after persistence', async () => {
    const user = userEvent.setup()
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    mockFetchWorkflowDraft.mockImplementationOnce(async () => {
      const saved = mockUpdateEnvironmentVariables.mock.calls[0]![0].environmentVariables[0]!
      return {
        environment_variables: [{ ...saved, value: '********************' }],
      }
    })
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [], envSecrets: {} },
    })

    await createSecretVariable(user, { name: 'secret_key', value: '1234567890' })

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          name: 'secret_key',
          value: '[__HIDDEN__]',
          value_type: 'secret',
        }),
      ]),
    )
    expect(Object.values(store.getState().envSecrets)).toEqual(['123456************90'])
  })

  it('retains masks for multiple secrets saved through the reachable queue', async () => {
    const user = userEvent.setup()
    let resolveFirstPersistence!: (value: unknown) => void
    mockUpdateEnvironmentVariables
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstPersistence = resolve
        }),
      )
      .mockResolvedValueOnce({})
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [], envSecrets: {} },
    })

    await createSecretVariable(user, { name: 'secret_a', value: 'first-secret-01' })
    await waitFor(() => expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1))
    await createSecretVariable(user, { name: 'secret_b', value: 'second-secret-02' })
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)

    await act(async () => resolveFirstPersistence({}))
    await waitFor(() => expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(2))
    expect(store.getState().environmentVariables.map((env) => env.name)).toEqual([
      'secret_b',
      'secret_a',
    ])
    expect(Object.values(store.getState().envSecrets)).toEqual([
      'first-************01',
      'second************02',
    ])
  })

  it('clears the edited variable when the real form closes', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })
    renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await openEditVariable(user, env.name)
    expect(screen.getByRole('textbox', { name: 'workflow.env.modal.name' })).toHaveValue(env.name)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'workflow.env.modal.name' }),
      ).not.toBeInTheDocument(),
    )
    await openCreateVariable(user)

    expect(screen.getByRole('textbox', { name: 'workflow.env.modal.name' })).toHaveValue('')
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('renames existing secrets and updates affected nodes without re-saving the secret', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    const nodes = [
      createCodeNode('node-1', [{ variable: 'key', value_selector: ['env', env.name] }]),
      createCodeNode('node-2'),
    ]
    const { getNodes, store } = renderPanel({
      nodes,
      initialStoreState: {
        environmentVariables: [env],
        envSecrets: { [env.id]: '[__HIDDEN__]' },
      },
    })

    await openEditVariable(user, env.name)
    await setTextField('workflow.env.modal.name', 'renamed_key', user)
    await saveForm(user)

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({ name: 'renamed_key', value: '[__HIDDEN__]' }),
      ]),
    )
    expect(store.getState().envSecrets).toEqual({ [env.id]: '[__HIDDEN__]' })
    expect(getNodes()).toEqual([
      expect.objectContaining({
        id: 'node-1',
        data: expect.objectContaining({
          variables: [{ variable: 'key', value_selector: ['env', 'renamed_key'] }],
        }),
      }),
      expect.objectContaining({ id: 'node-2' }),
    ])
  })

  it('converts edited plain variables into masked secrets', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await openEditVariable(user, env.name)
    await user.click(screen.getByRole('button', { name: 'Secret', pressed: false }))
    await setTextField('workflow.env.modal.value', 'abcdef123456', user)
    await saveForm(user)

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({ value: '[__HIDDEN__]', value_type: 'secret' }),
      ]),
    )
    expect(store.getState().envSecrets).toEqual({ [env.id]: 'abcdef************56' })
  })

  it('reconciles referenced nodes when a shared model changes', async () => {
    const user = userEvent.setup()
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })
    mockFetchModelParameterRulesForModel.mockResolvedValue([modelRule])
    const env = oldModelEnv()
    const llmNode = createLLMNode({
      data: {
        model: {
          provider: 'old-provider',
          name: 'old-model',
          mode: 'chat',
          completion_params: { temperature: 0.7, obsolete: true },
        },
        model_selector: ['env', env.name],
        vision: {
          enabled: true,
          configs: { detail: 'low', variable_selector: ['sys', 'files'] },
        },
      },
    })
    const { getNodes } = renderPanel({
      nodes: [llmNode],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() =>
      expect(getNodes()[0]?.data).toEqual(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'new-provider',
            name: 'new-model',
            completion_params: { temperature: 0.7 },
          }),
          vision: { enabled: false },
        }),
      ),
    )
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(false, expect.any(Object), {
      environmentVariablePatch: {
        environmentVariables: [
          expect.objectContaining({ value: expect.objectContaining({ name: 'new-model' }) }),
        ],
        deletedEnvironmentVariableIds: [],
      },
    })
    expect(emit).toHaveBeenCalledWith('collaboration_event', {
      type: 'vars_and_features_update',
    })
  })

  it('persists shared model parameters without rewriting the graph', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv({
      value: {
        provider: 'old-provider',
        name: 'old-model',
        mode: 'chat',
        completion_params: { temperature: 0.2 },
      },
    })
    const { getNodes, store } = renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await openEditVariable(user, env.name)
    await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' })
    await user.clear(temperature)
    await user.type(temperature, '0.8')
    await user.tab()
    await user.keyboard('{Escape}')
    await saveForm(user)

    await waitFor(() =>
      expect(store.getState().environmentVariables[0]?.value).toEqual(
        expect.objectContaining({ completion_params: { temperature: 0.8 } }),
      ),
    )
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [
        expect.objectContaining({
          value: expect.objectContaining({ completion_params: { temperature: 0.8 } }),
        }),
      ],
      deletedEnvironmentVariableIds: [],
    })
    expect(getNodes()).toEqual([])
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('persists follower graph edits before asking the leader to sync', async () => {
    const user = userEvent.setup()
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(false)
    const env = oldModelEnv()
    const { store } = renderPanel({
      nodes: [createLLMNode({ data: { model_selector: ['env', env.name] } })],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() =>
      expect(store.getState().environmentVariables[0]?.value).toEqual(
        expect.objectContaining({ provider: 'new-provider', name: 'new-model' }),
      ),
    )
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [
        expect.objectContaining({ value: expect.objectContaining({ name: 'new-model' }) }),
      ],
      deletedEnvironmentVariableIds: [],
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('collaboration_event', {
      type: 'vars_and_features_update',
      data: { syncWorkflowDraft: true },
    })
  })

  it.each([false, true])(
    'reports a follower save failure only if the server did not commit it (committed: %s)',
    async (committed) => {
      const user = userEvent.setup()
      const notifyError = vi.spyOn(toast, 'error')
      notifyError.mockClear()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
      vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(false)
      const env = oldModelEnv()
      const savedEnv = oldModelEnv({
        value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
      })
      const message = committed ? 'Response lost' : 'You do not have permission to edit this app.'
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [env] })
      mockUpdateEnvironmentVariables.mockImplementationOnce(async (payload) => {
        if (committed)
          mockFetchWorkflowDraft.mockResolvedValue({
            environment_variables: payload.environmentVariables,
          })
        throw new Error(message)
      })
      const llmNode = createLLMNode({ data: { model_selector: ['env', env.name] } })
      const { store, getNodes } = renderPanel({
        nodes: [llmNode],
        initialStoreState: { environmentVariables: [env], envSecrets: {} },
      })

      await changeExistingModel(user, env.name)

      await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalled())
      await waitFor(() =>
        expect(store.getState().environmentVariables).toMatchObject([committed ? savedEnv : env]),
      )
      if (committed) expect(notifyError).not.toHaveBeenCalled()
      else {
        await waitFor(() => expect(notifyError).toHaveBeenCalledExactlyOnceWith(message))
        expect(getNodes()[0]?.data).toEqual(llmNode.data)
      }
      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    },
  )

  it('preserves the shared model and nodes when model rules cannot be fetched', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    const llmNode = createLLMNode({
      data: {
        model: {
          provider: 'old-provider',
          name: 'old-model',
          mode: 'chat',
          completion_params: { temperature: 0.7 },
        },
        model_selector: ['env', env.name],
      },
    })
    mockFetchModelParameterRulesForModel.mockRejectedValueOnce(new Error('network error'))
    const { getNodes, store } = renderPanel({
      nodes: [llmNode],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() => expect(store.getState().environmentVariables).toEqual([env]))
    expect(getNodes()[0]?.data).toEqual(llmNode.data)
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('rolls back a shared model when both persistence paths fail', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('environment API failed'))
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() => {
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().environmentVariables).toEqual([env])
    })
  })

  it('preserves a newer remote value when a local model save fails', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    const remoteEnv = oldModelEnv({
      value: { provider: 'remote-provider', name: 'remote-model', mode: 'chat' },
    })
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('environment API failed'))
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    mockFetchWorkflowDraft.mockResolvedValueOnce({ environment_variables: [remoteEnv] })
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() => {
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().environmentVariables).toEqual([remoteEnv])
    })
  })

  it('accepts a model save that committed before its response failed', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    const savedEnv = oldModelEnv({
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('response lost'))
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    mockFetchWorkflowDraft.mockResolvedValueOnce({ environment_variables: [savedEnv] })
    const { store } = renderPanel({
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() => expect(store.getState().environmentVariables).toEqual([savedEnv]))
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('rolls back model reconciliation when atomic draft sync fails', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    const llmNode = createLLMNode({ data: { model_selector: ['env', env.name] } })
    let modelAtSync: unknown
    const { getNodes, store } = renderPanel({
      nodes: [llmNode],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      modelAtSync = getNodes()[0]?.data.model
      callback?.onError?.()
    })

    await changeExistingModel(user, env.name)

    await waitFor(() => {
      expect(getNodes()[0]?.data.model).toMatchObject({
        provider: 'old-provider',
        name: 'old-model',
      })
      expect(store.getState().environmentVariables).toEqual([env])
    })
    expect(modelAtSync).toMatchObject({ provider: 'new-provider', name: 'new-model' })
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('keeps model reconciliation when a remote snapshot changes only alias metadata', async () => {
    const user = userEvent.setup()
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(true)
    const env = oldModelEnv()
    let savedEnv: EnvironmentVariable | undefined
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback, options) => {
      savedEnv = options?.environmentVariablePatch?.environmentVariables[0]
      callback?.onSuccess?.()
    })
    mockFetchWorkflowDraft.mockImplementationOnce(async () => {
      if (!savedEnv) throw new Error('No model save reached draft persistence')
      return {
        environment_variables: [{ ...savedEnv, description: 'remote description' }],
      }
    })
    const { getNodes, store } = renderPanel({
      nodes: [createLLMNode({ data: { model_selector: ['env', env.name] } })],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({ description: 'remote description' }),
      ]),
    )
    expect(getNodes()[0]?.data.model).toMatchObject({
      provider: 'new-provider',
      name: 'new-model',
    })
  })

  it('should reconcile a model change before a queued metadata-only save', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    const requestPayloads: Array<{
      description: string
      model: string | undefined
      persistence: 'draft' | 'environment'
    }> = []
    let resolveFirstRules!: (rules: ModelParameterRule[]) => void
    mockFetchModelParameterRulesForModel.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstRules = resolve
      }),
    )
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback, options) => {
      const savedEnv = options?.environmentVariablePatch?.environmentVariables[0]
      requestPayloads.push({
        description: savedEnv?.description ?? '',
        model: isLLMEnvironmentVariableValue(savedEnv?.value) ? savedEnv.value.name : undefined,
        persistence: 'draft',
      })
      callback?.onSuccess?.()
    })
    mockUpdateEnvironmentVariables.mockImplementationOnce(async (payload) => {
      const savedEnv = payload.environmentVariables[0]
      requestPayloads.push({
        description: savedEnv?.description ?? '',
        model: isLLMEnvironmentVariableValue(savedEnv?.value) ? savedEnv.value.name : undefined,
        persistence: 'environment',
      })
      return {}
    })
    const { getNodes, store } = renderPanel({
      nodes: [createLLMNode({ data: { model_selector: ['env', env.name] } })],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)
    await openEditVariable(user, env.name)
    await selectModel(user, 'old-model', 'new-model')
    await setTextField('workflow.env.modal.description', 'updated description', user)
    await saveForm(user)

    expect(mockFetchModelParameterRulesForModel).toHaveBeenCalledTimes(1)
    expect(requestPayloads).toEqual([])

    await act(async () => resolveFirstRules([]))

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          description: 'updated description',
          value: expect.objectContaining({ name: 'new-model' }),
        }),
      ]),
    )
    expect(requestPayloads).toEqual([
      { description: '', model: 'new-model', persistence: 'draft' },
      {
        description: 'updated description',
        model: 'new-model',
        persistence: 'environment',
      },
    ])
    expect(getNodes()[0]?.data.model).toMatchObject({
      provider: 'new-provider',
      name: 'new-model',
    })
  })

  it('should serialize shared-model persistence so the latest save reaches the server last', async () => {
    const user = userEvent.setup()
    const env = oldModelEnv()
    let persistedEnv = env
    let resolveFirstPersistence!: () => void
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(false)
    mockFetchWorkflowDraft.mockImplementation(async () => ({
      environment_variables: [persistedEnv],
    }))
    mockUpdateEnvironmentVariables
      .mockImplementationOnce(
        (payload) =>
          new Promise((resolve) => {
            resolveFirstPersistence = () => {
              persistedEnv = payload.environmentVariables[0]!
              resolve({})
            }
          }),
      )
      .mockImplementationOnce(async (payload) => {
        persistedEnv = payload.environmentVariables[0]!
        return {}
      })
    const { getNodes, store } = renderPanel({
      nodes: [createLLMNode({ data: { model_selector: ['env', env.name] } })],
      initialStoreState: { environmentVariables: [env], envSecrets: {} },
    })

    await changeExistingModel(user, env.name)
    await waitFor(() => expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1))
    await openEditVariable(user, env.name)
    await selectModel(user, 'new-model', 'newest-model')
    await setTextField('workflow.env.modal.description', 'latest description', user)
    await saveForm(user)
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)

    await act(async () => resolveFirstPersistence())

    await waitFor(() =>
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          description: 'latest description',
          value: expect.objectContaining({ name: 'newest-model' }),
        }),
      ]),
    )
    expect(
      mockUpdateEnvironmentVariables.mock.calls.map(([payload]) => {
        const savedEnv = payload.environmentVariables[0]!
        return {
          description: savedEnv.description,
          model: isLLMEnvironmentVariableValue(savedEnv.value) ? savedEnv.value.name : undefined,
        }
      }),
    ).toEqual([
      { description: '', model: 'new-model' },
      { description: 'latest description', model: 'newest-model' },
    ])
    expect(getNodes()[0]?.data.model).toMatchObject({
      provider: 'new-provider',
      name: 'newest-model',
    })
  })

  it('keeps an edited secret available through draft fallback and then masks it', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('app-only endpoint'))
    const { store } = renderPanel({
      initialStoreState: {
        environmentVariables: [env],
        envSecrets: { [env.id]: '[__HIDDEN__]' },
      },
    })
    let valueDuringDraftFallback: EnvironmentVariable['value'] | undefined
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      valueDuringDraftFallback = store.getState().environmentVariables[0]?.value
      callback?.onSuccess?.()
    })

    await openEditVariable(user, env.name)
    await setTextField('workflow.env.modal.value', 'updated-secret-99', user)
    await saveForm(user)

    await waitFor(() =>
      expect(store.getState().environmentVariables[0]?.value).toBe('[__HIDDEN__]'),
    )
    expect(valueDuringDraftFallback).toBe('updated-secret-99')
    expect(store.getState().envSecrets).toEqual({ [env.id]: 'update************99' })
  })

  it('requires confirmation before deleting affected secret variables', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    const { getNodes, store } = renderPanel({
      nodes: [
        createCodeNode('node-1', [{ variable: 'key', value_selector: ['env', env.name] }]),
        createCodeNode('node-2'),
      ],
      initialStoreState: {
        environmentVariables: [env],
        envSecrets: { [env.id]: 'abcdef************56' },
      },
    })

    await user.click(screen.getByRole('button', { name: `common.operation.delete ${env.name}` }))
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    expect(store.getState().environmentVariables).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await user.click(screen.getByRole('button', { name: `common.operation.delete ${env.name}` }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => expect(store.getState().environmentVariables).toEqual([]))
    expect(store.getState().envSecrets).toEqual({})
    expect(getNodes()).toEqual([
      expect.objectContaining({
        id: 'node-1',
        data: expect.objectContaining({ variables: [{ variable: 'key', value_selector: [] }] }),
      }),
      expect.objectContaining({ id: 'node-2' }),
    ])
  })
})
