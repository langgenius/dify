import type { ReactElement } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import EnvPanel from '../index'

const {
  mockDoSyncWorkflowDraft,
  mockGetNodes,
  mockSetNodes,
} = vi.hoisted(() => ({
  mockDoSyncWorkflowDraft: vi.fn(() => Promise.resolve()),
  mockGetNodes: vi.fn(() => []),
  mockSetNodes: vi.fn(),
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
    env,
    onClose,
    onSave,
  }: {
    env?: EnvironmentVariable
    onClose: () => void
    onSave: (env: EnvironmentVariable) => Promise<void>
  }) => (
    <div>
      <button
        onClick={() => onSave(env || {
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
})
