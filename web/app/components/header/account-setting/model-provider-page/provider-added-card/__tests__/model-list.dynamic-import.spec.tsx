import type { ModelItem, ModelProvider } from '../../declarations'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ModelList from '../model-list'

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['plugin.model_config'],
  }))
})

vi.mock('../../hooks', () => ({
  useLazyModelProviderDetail: () => ({
    loadProviderDetail: vi.fn(),
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('../model-load-balancing-modal', () => {
  throw new Error('Failed to load model load balancing modal')
})

vi.mock('../model-list-item', () => ({
  default: ({
    model,
    onModifyLoadBalancing,
  }: {
    model: ModelItem
    onModifyLoadBalancing: (model: ModelItem) => void
  }) => (
    <button type="button" onClick={() => onModifyLoadBalancing(model)}>
      {model.model}
    </button>
  ),
}))

describe('ModelList dynamic import failure', () => {
  const provider = {
    provider: 'test-provider',
    configurate_methods: [],
  } as unknown as ModelProvider
  const model = {
    model: 'gpt-4',
    model_type: 'llm',
    fetch_from: 'system',
  } as unknown as ModelItem

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears the loading dialog and reports an error when the modal module cannot load', async () => {
    render(<ModelList provider={provider} models={[model]} onCollapse={vi.fn()} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'gpt-4' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('common.api.actionFailed')
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
