import type { ApiKeyList as AppApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ApiKeyList as DatasetApiKeyList } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'
import { render } from '@/test/console/render'
import SecretKeyModal from '../secret-key-modal'

type MutationCallbacks<TData> = {
  onSuccess?: (data: TData) => void
}

const mockCurrentWorkspace = vi.fn().mockReturnValue({
  id: 'workspace-1',
  name: 'Test Workspace',
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: mockCurrentWorkspace(),
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
  }))
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (value: number) => `Formatted: ${value}`,
  }),
}))

let appApiKeys: AppApiKeyList = { data: [] }
let datasetApiKeys: DatasetApiKeyList = { data: [] }
let appApiKeysLoading = false
let datasetApiKeysLoading = false

const createAppApiKey = vi.fn(
  (_variables: unknown, callbacks?: MutationCallbacks<{ token: string }>) =>
    callbacks?.onSuccess?.({ token: 'new-app-token-123' }),
)
const deleteAppApiKey = vi.fn()
const createDatasetApiKey = vi.fn(
  (_variables: unknown, callbacks?: MutationCallbacks<{ token: string }>) =>
    callbacks?.onSuccess?.({ token: 'new-dataset-token-123' }),
)
const deleteDatasetApiKey = vi.fn()

let mutationHookIndex = 0
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: () => {
      const mutations = [createAppApiKey, deleteAppApiKey, createDatasetApiKey, deleteDatasetApiKey]
      const mutate = mutations[mutationHookIndex % mutations.length]
      mutationHookIndex += 1
      return { mutate }
    },
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      const isAppQuery = JSON.stringify(options.queryKey).includes('"apps"')
      return isAppQuery
        ? { data: appApiKeys, isLoading: appApiKeysLoading }
        : { data: datasetApiKeys, isLoading: datasetApiKeysLoading }
    },
  }
})

async function renderModal(appId?: string) {
  const onClose = vi.fn()
  const result = render(<SecretKeyModal isShow appId={appId} canManage onClose={onClose} />)
  await act(async () => {
    vi.runAllTimers()
  })
  return { ...result, onClose }
}

async function confirmFirstKeyDeletion() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  // Find the delete action by its icon: dataset rows have no copy control, so the
  // delete button is not always at a fixed index.
  const deleteButton = document.body.querySelector('.i-ri-delete-bin-line')?.closest('button')
  expect(deleteButton).toBeInTheDocument()
  await user.click(deleteButton!)
  await act(async () => {
    vi.runAllTimers()
  })
  await user.click(await screen.findByText('common.operation.confirm'))
}

describe('SecretKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mutationHookIndex = 0
    appApiKeys = { data: [] }
    datasetApiKeys = { data: [] }
    appApiKeysLoading = false
    datasetApiKeysLoading = false
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('renders the app API key dataset selected by appId', async () => {
    appApiKeys = {
      data: [
        {
          id: 'app-key-1',
          token: 'app-secret-token-123456789',
          type: 'app',
          created_at: 1,
        },
      ],
    }

    await renderModal('app-123')

    expect(screen.getByText('app...cret-token-123456789')).toBeInTheDocument()
  })

  it('renders the workspace dataset API keys without an appId', async () => {
    datasetApiKeys = {
      data: [
        {
          id: 'dataset-key-1',
          token: 'dataset-secret-token-123456789',
          type: 'dataset',
          created_at: 1,
        },
      ],
    }

    await renderModal()

    // Dataset keys are reveal-once: the backend returns them already masked, so the
    // modal renders the token as-is instead of re-masking it client-side.
    expect(screen.getByText('dataset-secret-token-123456789')).toBeInTheDocument()
  })

  it('creates an app API key through the generated mutation input', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderModal('app-123')

    await user.click(screen.getByText('appApi.apiKeyModal.createNewSecretKey'))

    expect(createAppApiKey).toHaveBeenCalledWith(
      { params: { resource_id: 'app-123' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(await screen.findByText('new-app-token-123')).toBeInTheDocument()
  })

  it('does not offer key creation in the dataset manage modal', async () => {
    await renderModal()

    // Dataset key creation lives in the separate Add API Key dialog, so the manage
    // modal hides the create button for the dataset (no appId) context.
    expect(screen.queryByText('appApi.apiKeyModal.createNewSecretKey')).not.toBeInTheDocument()
  })

  it('deletes an app API key through the generated mutation input', async () => {
    appApiKeys = {
      data: [
        {
          id: 'app-key-1',
          token: 'app-secret-token-123456789',
          type: 'app',
          created_at: 1,
        },
      ],
    }
    await renderModal('app-123')

    await confirmFirstKeyDeletion()

    await waitFor(() => {
      expect(deleteAppApiKey).toHaveBeenCalledWith({
        params: { resource_id: 'app-123', api_key_id: 'app-key-1' },
      })
    })
  })

  it('deletes a dataset API key through the generated mutation input', async () => {
    datasetApiKeys = {
      data: [
        {
          id: 'dataset-key-1',
          token: 'dataset-secret-token-123456789',
          type: 'dataset',
          created_at: 1,
        },
      ],
    }
    await renderModal()

    await confirmFirstKeyDeletion()

    await waitFor(() => {
      expect(deleteDatasetApiKey).toHaveBeenCalledWith({
        params: { api_key_id: 'dataset-key-1' },
      })
    })
  })
})
