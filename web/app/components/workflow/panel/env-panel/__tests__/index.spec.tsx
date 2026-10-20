import type { ReactElement } from 'react'
import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable, Node } from '@/app/components/workflow/types'
import type { consoleClient } from '@/service/console'
import { zGetWorkspacesCurrentModelProvidersByProviderModelsParameterRulesResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { useStoreApi } from 'reactflow'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import EnvPanel from '../index'

let initialNodes: Node[] = []
let graph: ReturnType<typeof useStoreApi> | undefined

function GraphProbe() {
  const store = useStoreApi()
  useLayoutEffect(() => {
    graph = store
  }, [store])
  return null
}

const getNodes = () => graph!.getState().getNodes()
const setNodes = (nodes: Node[]) => {
  if (graph) act(() => graph!.getState().setNodes(nodes))
  else initialNodes = nodes
}

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
  mockVariableTriggerState,
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
  >(async (_notRefresh, callback) => {
    callback?.onSuccess?.()
  }),
  mockVariableTriggerState: {
    savePayload: undefined as EnvironmentVariable | undefined,
  },
  mockUpdateEnvironmentVariables: vi.fn<
    (payload: {
      appId: string
      environmentVariables: EnvironmentVariable[]
      deletedEnvironmentVariableIds: string[]
    }) => Promise<unknown>
  >(() => Promise.resolve({})),
  mockFetchWorkflowDraft: vi.fn<() => Promise<{ environment_variables: EnvironmentVariable[] }>>(
    () => Promise.reject(new Error('draft refresh unavailable')),
  ),
  mockGetSocket: vi.fn<
    (appId: string) => { emit: (event: string, payload: unknown) => void } | null
  >(() => null),
  mockFetchModelParameterRulesForModel: vi.fn<
    (provider: string, modelId: string) => Promise<ModelParameterRule[]>
  >(() => Promise.resolve([])),
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

// The form is independently tested; keep its submission boundary small while the
// container owns the real popover, variable rows, confirmation, queue and persistence.
vi.mock('@/app/components/workflow/panel/env-panel/variable-modal', () => ({
  default: ({
    env,
    onClose,
    onSave,
  }: {
    env?: EnvironmentVariable
    onClose: () => void
    onSave: (env: EnvironmentVariable) => Promise<void>
  }) => (
    <div>
      <input aria-label="Variable being edited" readOnly value={env?.name ?? ''} />
      <button
        type="button"
        onClick={() =>
          onSave(
            mockVariableTriggerState.savePayload ??
              env ?? {
                id: 'env-created',
                name: 'created_name',
                value: 'created-value',
                value_type: 'string',
                description: 'created',
              },
          )
        }
      >
        Save variable
      </button>
      <button type="button" onClick={onClose}>
        Close variable modal
      </button>
    </div>
  ),
}))

async function saveVariable(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole('button', { name: 'Save variable' }))
    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelButton' }))
  await user.click(await screen.findByRole('button', { name: 'Save variable' }))
}

const createEnv = (overrides: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id: 'env-1',
  name: 'api_key',
  value: '[__HIDDEN__]',
  value_type: 'secret',
  description: 'secret description',
  ...overrides,
})

const renderWithProviders = (
  ui: ReactElement,
  storeState: Partial<Shape> = {},
  resource: EditorResource = { kind: 'app', appId: 'app-1', mode: 'workflow' },
) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: false },
  })
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider: 'new-provider',
      models: [createCatalogModelFixture({ model: 'new-model', features: [] })],
    }),
  ])
  return renderWorkflowFlowComponent(
    <>
      <GraphProbe />
      {ui}
    </>,
    {
      resource,
      queryClient,
      nodes: initialNodes,
      initialStoreState: storeState,
      hooksStoreProps: { doSyncWorkflowDraft: mockDoSyncWorkflowDraft },
      // Node rendering is outside this panel's contract; the React Flow graph stays real.
      reactFlowProps: { nodeTypes: { custom: () => null } },
    },
  )
}

describe('EnvPanel container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDoSyncWorkflowDraft.mockReset()
    mockUpdateEnvironmentVariables.mockReset()
    mockFetchWorkflowDraft.mockReset()
    mockFetchModelParameterRulesForModel.mockReset()
    mockDoSyncWorkflowDraft.mockImplementation(async (_notRefresh, callback) => {
      callback?.onSuccess?.()
    })
    initialNodes = []
    graph = undefined
    mockVariableTriggerState.savePayload = undefined
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
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
      envSecrets: {},
    })

    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          id: 'env-created',
          name: 'created_name',
          value: 'created-value',
        }),
      ])
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [expect.objectContaining({ id: 'env-created' })],
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
    const { store } = renderWithProviders(
      <EnvPanel />,
      {
        environmentVariables: [existingEnv],
        envSecrets: {},
      },
      { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    )
    let completeSync!: () => void
    let variablesSentToDraft: EnvironmentVariable[] = []
    mockDoSyncWorkflowDraft.mockImplementationOnce((_notRefresh, callback) => {
      variablesSentToDraft = store.getState().environmentVariables
      return new Promise((resolve) => {
        completeSync = () => {
          callback?.onSuccess?.()
          resolve()
        }
      })
    })

    await saveVariable(user)
    expect(await screen.findByText('created_name')).toBeInTheDocument()
    expect(variablesSentToDraft).toEqual([
      expect.objectContaining({ id: 'env-created', name: 'created_name', value: 'created-value' }),
      existingEnv,
    ])
    await act(async () => completeSync())

    expect(screen.getByText('created_name')).toBeInTheDocument()
    expect(screen.getByText('existing_variable')).toBeInTheDocument()
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockGetSocket).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('restores the persisted pipeline variable after draft sync fails and preserves other variables', async () => {
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
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })
    mockVariableTriggerState.savePayload = { ...existingEnv, name: 'rejected_name' }
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [existingEnv, untouchedEnv] })
    let failSync!: () => void
    mockDoSyncWorkflowDraft.mockImplementation(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    mockDoSyncWorkflowDraft.mockImplementationOnce(
      (_notRefresh, callback) =>
        new Promise((resolve) => {
          failSync = () => {
            callback?.onError?.()
            resolve()
          }
        }),
    )
    renderWithProviders(
      <EnvPanel />,
      {
        environmentVariables: [existingEnv, untouchedEnv],
        envSecrets: {},
      },
      { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    )

    await user.click(
      screen.getByRole('button', { name: 'common.operation.edit existing_variable' }),
    )
    await saveVariable(user)
    expect(
      await screen.findByRole('button', { name: 'common.operation.edit rejected_name' }),
    ).toBeInTheDocument()
    await act(async () => failSync())

    expect(
      await screen.findByRole('button', { name: 'common.operation.edit existing_variable' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.edit rejected_name' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('untouched_variable')).toBeInTheDocument()
    expect(mockFetchWorkflowDraft).toHaveBeenCalled()
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockGetSocket).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('should delete unused variables and sync draft changes', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: `common.operation.delete ${env.name}` }))

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([])
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [],
      deletedEnvironmentVariableIds: [env.id],
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should add secret variables, persist masked secrets, and sanitize the stored env value', async () => {
    const user = userEvent.setup()
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    const secretEnv = createEnv({
      id: 'env-secret',
      name: 'secret_key',
      value: '1234567890',
      value_type: 'secret',
    })
    mockVariableTriggerState.savePayload = secretEnv
    mockFetchWorkflowDraft.mockResolvedValueOnce({
      environment_variables: [{ ...secretEnv, value: '********************' }],
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
      envSecrets: {},
    })

    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          id: 'env-secret',
          name: 'secret_key',
          value: '[__HIDDEN__]',
          value_type: 'secret',
        }),
      ])
    })
    expect(store.getState().envSecrets).toEqual({
      'env-secret': '123456************90',
    })
  })

  it('should keep a new secret available until draft fallback persistence finishes', async () => {
    const user = userEvent.setup()
    const secretEnv = createEnv({
      id: 'env-secret',
      name: 'secret_key',
      value: '1234567890',
      value_type: 'secret',
    })
    mockVariableTriggerState.savePayload = secretEnv
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('app-only endpoint'))
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
      envSecrets: {},
    })
    let valueDuringDraftFallback: EnvironmentVariable['value'] | undefined
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      valueDuringDraftFallback = store.getState().environmentVariables[0]?.value
      callback?.onSuccess?.()
    })

    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables[0]?.value).toBe('[__HIDDEN__]')
    })
    expect(valueDuringDraftFallback).toBe(secretEnv.value)
    expect(store.getState().envSecrets).toEqual({
      [secretEnv.id]: '123456************90',
    })
  })

  it('should retain masks for multiple secrets saved through the queue', async () => {
    const user = userEvent.setup()
    const firstSecret = createEnv({
      id: 'secret-a',
      name: 'secret_a',
      value: 'first-secret-01',
      value_type: 'secret',
    })
    const secondSecret = createEnv({
      id: 'secret-b',
      name: 'secret_b',
      value: 'second-secret-02',
      value_type: 'secret',
    })
    let resolveFirstPersistence!: (value: unknown) => void
    mockUpdateEnvironmentVariables
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstPersistence = resolve
        }),
      )
      .mockResolvedValueOnce({})
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
      envSecrets: {},
    })

    mockVariableTriggerState.savePayload = firstSecret
    await saveVariable(user)
    await waitFor(() => expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1))

    mockVariableTriggerState.savePayload = secondSecret
    await saveVariable(user)
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)
    resolveFirstPersistence({})

    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(2)
      expect(store.getState().envSecrets).toEqual({
        [firstSecret.id]: 'first-************01',
        [secondSecret.id]: 'second************02',
      })
    })
  })

  it('should clear the current variable when the variable modal closes', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })

    renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    expect(await screen.findByRole('textbox', { name: 'Variable being edited' })).toHaveValue(
      'api_key',
    )

    await user.click(screen.getByRole('button', { name: 'Close variable modal' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save variable' })).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelButton' }))
    expect(await screen.findByRole('textbox', { name: 'Variable being edited' })).toHaveValue('')
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('should rename existing secret variables and update affected nodes without re-saving unchanged secrets', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: 'renamed_key',
      value: '[__HIDDEN__]',
      value_type: 'secret',
    })
    setNodes([
      createCodeNode('node-1', [{ variable: 'key', value_selector: ['env', env.name] }]),
      createCodeNode('node-2'),
    ])

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {
        [env.id]: '[__HIDDEN__]',
      },
    })

    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          id: env.id,
          name: 'renamed_key',
          value: '[__HIDDEN__]',
          value_type: 'secret',
        }),
      ])
    })
    expect(store.getState().envSecrets).toEqual({
      [env.id]: '[__HIDDEN__]',
    })
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

  it('should convert edited plain variables into secrets and store the masked secret value', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value: 'abcdef123456',
      value_type: 'secret',
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          id: env.id,
          value: '[__HIDDEN__]',
          value_type: 'secret',
        }),
      ])
    })
    expect(store.getState().envSecrets).toEqual({
      [env.id]: 'abcdef************56',
    })
  })

  it('should reconcile nodes when a shared LLM model changes', async () => {
    const user = userEvent.setup()
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
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
    setNodes([llmNode])
    mockFetchModelParameterRulesForModel.mockResolvedValue([
      {
        name: 'temperature',
        type: 'float',
        min: 0,
        max: 2,
        label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
        required: false,
      },
    ])

    renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(getNodes()).toEqual([
        expect.objectContaining({
          id: 'llm-node',
          data: expect.objectContaining({
            model: expect.objectContaining({
              provider: 'new-provider',
              name: 'new-model',
              completion_params: { temperature: 0.7 },
            }),
            vision: { enabled: false },
          }),
        }),
      ])
    })
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(false, expect.any(Object), {
      environmentVariablePatch: {
        environmentVariables: [
          expect.objectContaining({
            id: env.id,
            value: expect.objectContaining({ name: 'new-model' }),
          }),
        ],
        deletedEnvironmentVariableIds: [],
      },
    })
    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith('collaboration_event', {
        type: 'vars_and_features_update',
      })
    })
  })

  it('should persist shared LLM parameters without rewriting referenced nodes', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: {
        provider: 'shared-provider',
        name: 'shared-model',
        mode: 'chat',
        completion_params: { temperature: 0.2 },
      },
    })
    const nextEnv = createEnv({
      ...env,
      value: {
        provider: 'shared-provider',
        name: 'shared-model',
        mode: 'chat',
        completion_params: { temperature: 0.8 },
      },
    })
    mockVariableTriggerState.savePayload = nextEnv

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([nextEnv])
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [nextEnv],
      deletedEnvironmentVariableIds: [],
    })
    expect(getNodes()).toMatchObject(initialNodes)
  })

  it('should persist follower graph edits before asking the leader to sync', async () => {
    const user = userEvent.setup()
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(false)
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const nextEnv = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    const llmNode = createLLMNode({
      data: {
        model_selector: ['env', env.name],
      },
    })
    mockVariableTriggerState.savePayload = nextEnv
    setNodes([llmNode])

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([nextEnv])
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledWith({
      appId: 'app-1',
      environmentVariables: [nextEnv],
      deletedEnvironmentVariableIds: [],
    })
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('collaboration_event', {
      type: 'vars_and_features_update',
      data: { syncWorkflowDraft: true },
    })
  })

  it('should reconcile the latest node parameters after model rules finish loading', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    const staleNode = createLLMNode({
      data: {
        model: {
          provider: 'old-provider',
          name: 'old-model',
          mode: 'chat',
          completion_params: { temperature: 0.2 },
        },
        model_selector: ['env', env.name],
      },
    })
    const latestNode = createLLMNode({
      ...staleNode,
      data: {
        ...staleNode.data,
        model: {
          ...staleNode.data.model,
          completion_params: { temperature: 0.9, obsolete: true },
        },
      },
    })
    let resolveRules!: (rules: ModelParameterRule[]) => void
    mockFetchModelParameterRulesForModel.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRules = resolve
      }),
    )
    setNodes([staleNode])

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)
    await waitFor(() => {
      expect(mockFetchModelParameterRulesForModel).toHaveBeenCalledTimes(1)
    })
    expect(store.getState().environmentVariables).toEqual([env])
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()

    setNodes([latestNode])
    resolveRules([
      {
        name: 'temperature',
        type: 'float',
        min: 0,
        max: 2,
        label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
        required: false,
      },
    ])

    await waitFor(() => {
      expect(getNodes()).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            model: expect.objectContaining({ completion_params: { temperature: 0.9 } }),
          }),
        }),
      ])
    })
  })

  it('should preserve the shared model and nodes when model rules cannot be fetched', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
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
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    setNodes([llmNode])
    mockFetchModelParameterRulesForModel.mockRejectedValueOnce(new Error('network error'))

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(mockFetchModelParameterRulesForModel).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([env])
    })
    expect(getNodes()).toMatchObject(initialNodes)
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should roll back a shared model when both persistence paths fail', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('environment API failed'))
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().environmentVariables).toEqual([env])
    })
    expect(getNodes()).toMatchObject(initialNodes)
  })

  it('should preserve a newer remote value when a local alias save fails', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const remoteEnv = createEnv({
      ...env,
      value: { provider: 'remote-provider', name: 'remote-model', mode: 'chat' },
    })
    mockVariableTriggerState.savePayload = createEnv({
      ...env,
      value: { provider: 'new-provider', name: 'local-model', mode: 'chat' },
    })
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('environment API failed'))
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    mockFetchWorkflowDraft.mockResolvedValueOnce({ environment_variables: [remoteEnv] })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().environmentVariables).toEqual([remoteEnv])
    })
  })

  it('should preserve an observed remote value when failure recovery cannot refetch', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const remoteEnv = createEnv({
      ...env,
      value: { provider: 'remote-provider', name: 'remote-model', mode: 'chat' },
    })
    mockVariableTriggerState.savePayload = createEnv({
      ...env,
      value: { provider: 'new-provider', name: 'local-model', mode: 'chat' },
    })
    let rejectPersistence!: (reason: Error) => void
    mockUpdateEnvironmentVariables.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectPersistence = reject
      }),
    )
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)
    await waitFor(() => expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1))

    act(() => {
      store.getState().setEnvironmentVariables([remoteEnv])
    })
    rejectPersistence(new Error('environment API failed'))

    await waitFor(() => {
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().environmentVariables).toEqual([remoteEnv])
    })
  })

  it('should accept an alias save that committed before its response failed', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const savedEnv = createEnv({
      ...env,
      value: { provider: 'new-provider', name: 'saved-model', mode: 'chat' },
    })
    mockVariableTriggerState.savePayload = savedEnv
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('response lost'))
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      callback?.onError?.()
    })
    mockFetchWorkflowDraft.mockResolvedValueOnce({ environment_variables: [savedEnv] })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([savedEnv])
    })
    expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('should roll back model reconciliation when the atomic draft sync fails', async () => {
    const user = userEvent.setup()
    let modelAtSync: unknown
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const llmNode = createLLMNode({
      data: {
        model_selector: ['env', env.name],
      },
    })
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    setNodes([llmNode])
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      modelAtSync = getNodes()[0]?.data.model
      setNodes([
        createLLMNode({
          id: llmNode.id,
          data: {
            ...llmNode.data,
            title: 'Concurrent edit',
            model: {
              ...llmNode.data.model,
              provider: 'new-provider',
              name: 'new-model',
            },
          },
        }),
      ])
      callback?.onError?.()
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(getNodes()[0]?.data.model).toMatchObject({
        provider: 'old-provider',
        name: 'old-model',
      })
      expect(store.getState().environmentVariables).toEqual([env])
    })
    expect(getNodes()).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Concurrent edit',
          model: expect.objectContaining({
            provider: 'old-provider',
            name: 'old-model',
          }),
        }),
      }),
    ])
    expect(modelAtSync).toMatchObject({ provider: 'new-provider', name: 'new-model' })
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('should roll back a graph edit when draft sync settles without succeeding', async () => {
    const user = userEvent.setup()
    let modelAtSync: unknown
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const llmNode = createLLMNode({
      data: {
        model_selector: ['env', env.name],
      },
    })
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    setNodes([llmNode])
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      modelAtSync = getNodes()[0]?.data.model
      callback?.onSettled?.()
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(getNodes()[0]?.data.model).toMatchObject({
        provider: 'old-provider',
        name: 'old-model',
      })
      expect(store.getState().environmentVariables).toEqual([env])
    })
    expect(modelAtSync).toMatchObject({ provider: 'new-provider', name: 'new-model' })
    expect(mockUpdateEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('should reconcile a model change before a queued metadata-only save', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const llmNode = createLLMNode({
      data: {
        model_selector: ['env', env.name],
      },
    })
    let resolveFirstRules!: (rules: ModelParameterRule[]) => void
    mockFetchModelParameterRulesForModel.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstRules = resolve
      }),
    )
    setNodes([llmNode])
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
      description: 'updated description',
    })
    await saveVariable(user)
    expect(mockFetchModelParameterRulesForModel).toHaveBeenCalledTimes(1)

    resolveFirstRules([])

    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environmentVariables: [
          expect.objectContaining({
            description: 'updated description',
            value: expect.objectContaining({ name: 'new-model' }),
          }),
        ],
      }),
    )
    expect(getNodes()[0]?.data.model).toMatchObject({ provider: 'new-provider', name: 'new-model' })
    expect(store.getState().environmentVariables).toEqual([
      expect.objectContaining({
        description: 'updated description',
        value: expect.objectContaining({ name: 'new-model' }),
      }),
    ])
  })

  it('should serialize shared-model persistence so the latest save reaches the server last', async () => {
    const user = userEvent.setup()
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    let resolveFirstPersistence!: (value: unknown) => void
    mockUpdateEnvironmentVariables
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstPersistence = resolve
        }),
      )
      .mockResolvedValueOnce({})
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })

    renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)
    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)
    })

    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'newest-model', mode: 'chat' },
    })
    await saveVariable(user)
    expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)

    resolveFirstPersistence({})
    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(2)
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environmentVariables: [
          expect.objectContaining({ value: expect.objectContaining({ name: 'newest-model' }) }),
        ],
      }),
    )
  })

  it('should preserve a remote update to an untouched alias across queued local saves', async () => {
    const user = userEvent.setup()
    const localEnv = createEnv({
      id: 'env-local',
      name: 'local_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-local', mode: 'chat' },
    })
    const remoteEnv = createEnv({
      id: 'env-remote',
      name: 'remote_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-remote', mode: 'chat' },
    })
    const remotelyUpdatedEnv = createEnv({
      ...remoteEnv,
      value: { provider: 'remote-provider', name: 'remote-update', mode: 'chat' },
    })
    let resolveFirstPersistence!: (value: unknown) => void
    mockUpdateEnvironmentVariables
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstPersistence = resolve
        }),
      )
      .mockResolvedValueOnce({})
    mockVariableTriggerState.savePayload = createEnv({
      ...localEnv,
      value: { provider: 'new-provider', name: 'first-local-update', mode: 'chat' },
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [localEnv, remoteEnv],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${localEnv.name}` }))
    await saveVariable(user)
    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1)
    })

    act(() => {
      store.getState().setEnvironmentVariables([localEnv, remotelyUpdatedEnv])
    })
    mockVariableTriggerState.savePayload = createEnv({
      ...localEnv,
      value: { provider: 'new-provider', name: 'second-local-update', mode: 'chat' },
    })
    await saveVariable(user)
    resolveFirstPersistence({})

    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(2)
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environmentVariables: [
          expect.objectContaining({
            id: localEnv.id,
            value: expect.objectContaining({ name: 'second-local-update' }),
          }),
        ],
        deletedEnvironmentVariableIds: [],
      }),
    )
  })

  it('should keep a newer server value for the same alias after a delayed local response', async () => {
    const user = userEvent.setup()
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const localEnv = createEnv({
      ...env,
      value: { provider: 'local-provider', name: 'local-model', mode: 'chat' },
    })
    const remoteEnv = createEnv({
      ...env,
      value: { provider: 'remote-provider', name: 'remote-model', mode: 'chat' },
    })
    let resolvePersistence!: (value: unknown) => void
    mockUpdateEnvironmentVariables.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePersistence = resolve
      }),
    )
    mockFetchWorkflowDraft.mockResolvedValueOnce({ environment_variables: [remoteEnv] })
    mockVariableTriggerState.savePayload = localEnv

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)
    await waitFor(() => expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(1))

    act(() => {
      store.getState().setEnvironmentVariables([remoteEnv])
    })
    resolvePersistence({})

    await waitFor(() => {
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().environmentVariables).toEqual([remoteEnv])
    })
  })

  it('should keep model reconciliation when only remote alias metadata differs', async () => {
    const user = userEvent.setup()
    vi.spyOn(collaborationManager, 'isConnected').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'getIsLeader').mockReturnValue(true)
    const env = createEnv({
      name: 'shared_model',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-model', mode: 'chat' },
    })
    const localEnv = createEnv({
      ...env,
      description: 'local description',
      value: { provider: 'new-provider', name: 'new-model', mode: 'chat' },
    })
    const serverEnv = { ...localEnv, description: 'remote description' }
    const llmNode = createLLMNode({
      data: {
        model_selector: ['env', env.name],
      },
    })
    mockVariableTriggerState.savePayload = localEnv
    setNodes([llmNode])
    mockFetchWorkflowDraft.mockResolvedValueOnce({ environment_variables: [serverEnv] })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([serverEnv])
    })
    expect(getNodes()[0]?.data.model).toMatchObject({ provider: 'new-provider', name: 'new-model' })
    expect(getNodes()[0]?.data?.model).toEqual(
      expect.objectContaining({ provider: 'new-provider', name: 'new-model' }),
    )
  })

  it('should carry a draft-fallback alias save into the next queued alias update', async () => {
    const user = userEvent.setup()
    const firstEnv = createEnv({
      id: 'env-a',
      name: 'model_a',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-a', mode: 'chat' },
    })
    const secondEnv = createEnv({
      id: 'env-b',
      name: 'model_b',
      value_type: 'llm',
      value: { provider: 'old-provider', name: 'old-b', mode: 'chat' },
    })
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('app-only endpoint'))
    mockVariableTriggerState.savePayload = createEnv({
      id: firstEnv.id,
      name: firstEnv.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-a', mode: 'chat' },
    })

    renderWithProviders(<EnvPanel />, {
      environmentVariables: [firstEnv, secondEnv],
      envSecrets: {},
    })
    await user.click(screen.getByRole('button', { name: `common.operation.edit ${firstEnv.name}` }))
    await saveVariable(user)
    await waitFor(() => {
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })

    mockVariableTriggerState.savePayload = createEnv({
      id: secondEnv.id,
      name: secondEnv.name,
      value_type: 'llm',
      value: { provider: 'new-provider', name: 'new-b', mode: 'chat' },
    })
    await user.click(
      screen.getByRole('button', { name: `common.operation.edit ${secondEnv.name}` }),
    )
    await saveVariable(user)

    await waitFor(() => {
      expect(mockUpdateEnvironmentVariables).toHaveBeenCalledTimes(2)
    })
    expect(mockUpdateEnvironmentVariables).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environmentVariables: [
          expect.objectContaining({
            id: secondEnv.id,
            value: expect.objectContaining({ name: 'new-b' }),
          }),
        ],
        deletedEnvironmentVariableIds: [],
      }),
    )
  })

  it('should persist a new masked secret when an existing secret variable changes value', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    mockVariableTriggerState.savePayload = createEnv({
      id: env.id,
      name: env.name,
      value: 'updated-secret-99',
      value_type: 'secret',
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {
        [env.id]: '[__HIDDEN__]',
      },
    })

    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([
        expect.objectContaining({
          id: env.id,
          value: '[__HIDDEN__]',
          value_type: 'secret',
        }),
      ])
    })
    expect(store.getState().envSecrets).toEqual({
      [env.id]: 'update************99',
    })
  })

  it('should keep an edited secret available until draft fallback persistence finishes', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    const nextEnv = createEnv({
      id: env.id,
      name: env.name,
      value: 'updated-secret-99',
      value_type: 'secret',
    })
    mockVariableTriggerState.savePayload = nextEnv
    mockUpdateEnvironmentVariables.mockRejectedValueOnce(new Error('app-only endpoint'))
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {
        [env.id]: '[__HIDDEN__]',
      },
    })
    let valueDuringDraftFallback: EnvironmentVariable['value'] | undefined
    mockDoSyncWorkflowDraft.mockImplementationOnce(async (_notRefresh, callback) => {
      valueDuringDraftFallback = store.getState().environmentVariables[0]?.value
      callback?.onSuccess?.()
    })

    await user.click(screen.getByRole('button', { name: `common.operation.edit ${env.name}` }))
    await saveVariable(user)

    await waitFor(() => {
      expect(store.getState().environmentVariables[0]?.value).toBe('[__HIDDEN__]')
    })
    expect(valueDuringDraftFallback).toBe(nextEnv.value)
    expect(store.getState().envSecrets).toEqual({
      [env.id]: 'update************99',
    })
  })

  it('should require confirmation before deleting affected secret variables', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    setNodes([
      createCodeNode('node-1', [{ variable: 'key', value_selector: ['env', env.name] }]),
      createCodeNode('node-2'),
    ])

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {
        [env.id]: 'abcdef************56',
      },
    })

    await user.click(screen.getByRole('button', { name: `common.operation.delete ${env.name}` }))
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    expect(store.getState().environmentVariables).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(
      screen.queryByRole('button', { name: 'common.operation.confirm' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `common.operation.delete ${env.name}` }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([])
    })
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
