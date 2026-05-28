import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import EnvPanel from '../index'

type MockWorkflowNode = {
  id: string
  data?: Record<string, unknown>
}

const {
  mockDoSyncWorkflowDraft,
  mockGetNodes,
  mockSetNodes,
  mockFindUsedVarNodes,
  mockUpdateNodeVars,
  mockVariableTriggerState,
  mockUpdateEnvironmentVariables,
  mockGetSocket,
} = vi.hoisted(() => ({
  mockDoSyncWorkflowDraft: vi.fn(() => Promise.resolve()),
  mockGetNodes: vi.fn<() => MockWorkflowNode[]>(() => []),
  mockSetNodes: vi.fn<(nodes: MockWorkflowNode[]) => void>(),
  mockFindUsedVarNodes: vi.fn<(selector: string[], nodes: MockWorkflowNode[]) => MockWorkflowNode[]>(() => []),
  mockUpdateNodeVars: vi.fn<(node: MockWorkflowNode, currentSelector: string[], nextSelector: string[]) => MockWorkflowNode>((node, _currentSelector, nextSelector) => ({
    ...node,
    data: {
      ...node.data,
      nextSelector,
    },
  })),
  mockVariableTriggerState: {
    savePayload: undefined as EnvironmentVariable | undefined,
  },
  mockUpdateEnvironmentVariables: vi.fn<(payload: { appId: string, environmentVariables: EnvironmentVariable[] }) => Promise<unknown>>(() => Promise.resolve({})),
  mockGetSocket: vi.fn<(appId: string) => { emit: (event: string, payload: unknown) => void } | null>(() => null),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
    }),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  findUsedVarNodes: mockFindUsedVarNodes,
  updateNodeVars: mockUpdateNodeVars,
}))

vi.mock('@/service/workflow', () => ({
  updateEnvironmentVariables: (payload: { appId: string, environmentVariables: EnvironmentVariable[] }) => mockUpdateEnvironmentVariables(payload),
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: (appId: string) => mockGetSocket(appId),
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm', () => ({
  default: ({
    isShow,
    onCancel,
    onConfirm,
  }: {
    isShow: boolean
    onCancel: () => void
    onConfirm: () => void
  }) => isShow
    ? (
        <div>
          <button onClick={onCancel}>Cancel remove</button>
          <button onClick={onConfirm}>Confirm remove</button>
        </div>
      )
    : null,
}))

vi.mock('@/app/components/workflow/panel/env-panel/env-item', () => ({
  default: ({
    env,
    onEdit,
    onDelete,
  }: {
    env: EnvironmentVariable
    onEdit: (env: EnvironmentVariable) => void
    onDelete: (env: EnvironmentVariable) => void
  }) => (
    <div>
      <span>{env.name}</span>
      <button onClick={() => onEdit(env)}>
        Edit
        {' '}
        {env.name}
      </button>
      <button onClick={() => onDelete(env)}>
        Delete
        {' '}
        {env.name}
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/panel/env-panel/variable-trigger', () => ({
  default: ({
    open,
    env,
    onClose,
    onSave,
    setOpen,
  }: {
    open: boolean
    env?: EnvironmentVariable
    onClose: () => void
    onSave: (env: EnvironmentVariable) => Promise<void>
    setOpen: (open: boolean) => void
  }) => (
    <div>
      <span>
        Variable trigger:
        {open ? 'open' : 'closed'}
        :
        {env?.name || 'new'}
      </span>
      <button onClick={() => setOpen(true)}>Open variable modal</button>
      <button
        onClick={() => onSave(mockVariableTriggerState.savePayload || env || {
          id: 'env-created',
          name: 'created_name',
          value: 'created-value',
          value_type: 'string',
          description: 'created',
        })}
      >
        Save variable
      </button>
      <button onClick={onClose}>Close variable modal</button>
    </div>
  ),
}))

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
) => {
  const store = createWorkflowStore({})
  store.setState(storeState)

  return {
    store,
    ...render(
      <WorkflowContext value={store}>
        {ui}
      </WorkflowContext>,
    ),
  }
}

describe('EnvPanel container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetNodes.mockReturnValue([])
    mockFindUsedVarNodes.mockReturnValue([])
    mockVariableTriggerState.savePayload = undefined
    mockUpdateEnvironmentVariables.mockResolvedValue({})
    mockGetSocket.mockReturnValue(null)
  })

  it('should close the panel from the header action', async () => {
    const user = userEvent.setup()
    const { container, store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
    })

    await user.click(container.querySelector('.cursor-pointer') as HTMLElement)

    expect(store.getState().showEnvPanel).toBe(false)
  })

  it('should add variables and normalize secret values after syncing', async () => {
    const user = userEvent.setup()
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: 'Save variable' }))

    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(store.getState().environmentVariables).toEqual([
      expect.objectContaining({
        id: 'env-created',
        name: 'created_name',
        value: 'created-value',
      }),
    ])
  })

  it('should delete unused variables and sync draft changes', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })
    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: `Delete ${env.name}` }))

    expect(store.getState().environmentVariables).toEqual([])
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('should add secret variables, persist masked secrets, and sanitize the stored env value', async () => {
    const user = userEvent.setup()
    mockVariableTriggerState.savePayload = createEnv({
      id: 'env-secret',
      name: 'secret_key',
      value: '1234567890',
      value_type: 'secret',
    })

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: 'Save variable' }))

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

  it('should clear the current variable when the variable modal closes', async () => {
    const user = userEvent.setup()
    const env = createEnv({ value_type: 'string', value: 'plain-text' })

    renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {},
    })

    await user.click(screen.getByRole('button', { name: `Edit ${env.name}` }))
    expect(screen.getByText('Variable trigger:open:api_key')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close variable modal' }))

    expect(screen.getByText('Variable trigger:open:new')).toBeInTheDocument()
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
    mockFindUsedVarNodes.mockReturnValue([{ id: 'node-1' }])
    mockGetNodes.mockReturnValue([
      { id: 'node-1', data: { nextSelector: ['env', env.name] } },
      { id: 'node-2', data: { untouched: true } },
    ])

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {
        [env.id]: '[__HIDDEN__]',
      },
    })

    await user.click(screen.getByRole('button', { name: `Edit ${env.name}` }))
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

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
    expect(mockUpdateNodeVars).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-1' }),
      ['env', env.name],
      ['env', 'renamed_key'],
    )
    expect(mockSetNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'node-1',
        data: expect.objectContaining({
          nextSelector: ['env', 'renamed_key'],
        }),
      }),
      expect.objectContaining({ id: 'node-2' }),
    ])
    expect(store.getState().controlPromptEditorRerenderKey).toBeGreaterThan(0)
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

    await user.click(screen.getByRole('button', { name: `Edit ${env.name}` }))
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

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

    await user.click(screen.getByRole('button', { name: `Edit ${env.name}` }))
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

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

  it('should require confirmation before deleting affected secret variables', async () => {
    const user = userEvent.setup()
    const env = createEnv()
    mockFindUsedVarNodes.mockReturnValue([{ id: 'node-1' }])
    mockGetNodes.mockReturnValue([
      { id: 'node-1', data: { nextSelector: ['env', env.name] } },
      { id: 'node-2', data: { untouched: true } },
    ])

    const { store } = renderWithProviders(<EnvPanel />, {
      environmentVariables: [env],
      envSecrets: {
        [env.id]: 'abcdef************56',
      },
    })

    await user.click(screen.getByRole('button', { name: `Delete ${env.name}` }))
    expect(screen.getByRole('button', { name: 'Cancel remove' })).toBeInTheDocument()
    expect(store.getState().environmentVariables).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Cancel remove' }))
    expect(screen.queryByRole('button', { name: 'Confirm remove' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `Delete ${env.name}` }))
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => {
      expect(store.getState().environmentVariables).toEqual([])
    })
    expect(store.getState().envSecrets).toEqual({})
    expect(mockUpdateNodeVars).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-1' }),
      ['env', env.name],
      [],
    )
  })
})
