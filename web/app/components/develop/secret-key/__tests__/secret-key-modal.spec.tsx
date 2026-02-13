import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'
import SecretKeyModal from '../secret-key-modal'

async function renderModal(ui: React.ReactElement) {
  const result = render(ui)
  await act(async () => {
    vi.runAllTimers()
  })
  return result
}

async function flushTransitions() {
  await act(async () => {
    vi.runAllTimers()
  })
  await act(async () => {
    vi.runAllTimers()
  })
}

const mockCurrentWorkspace = vi.fn().mockReturnValue({
  id: 'workspace-1',
  name: 'Test Workspace',
})
const mockIsCurrentWorkspaceManager = vi.fn().mockReturnValue(true)
const mockIsCurrentWorkspaceEditor = vi.fn().mockReturnValue(true)

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: mockCurrentWorkspace(),
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: vi.fn((value: number, _format: string) => `Formatted: ${value}`),
    formatDate: vi.fn((value: string, _format: string) => `Formatted: ${value}`),
  }),
}))

const mockCreateAppApikey = vi.fn().mockResolvedValue({ token: 'new-app-token-123' })
const mockDelAppApikey = vi.fn().mockResolvedValue({})
vi.mock('@/service/apps', () => ({
  createApikey: (...args: unknown[]) => mockCreateAppApikey(...args),
  delApikey: (...args: unknown[]) => mockDelAppApikey(...args),
}))

const mockCreateDatasetApikey = vi.fn().mockResolvedValue({ token: 'new-dataset-token-123' })
const mockDelDatasetApikey = vi.fn().mockResolvedValue({})
vi.mock('@/service/datasets', () => ({
  createApikey: (...args: unknown[]) => mockCreateDatasetApikey(...args),
  delApikey: (...args: unknown[]) => mockDelDatasetApikey(...args),
}))

const mockAppApiKeysData = vi.fn().mockReturnValue({ data: [] })
const mockIsAppApiKeysLoading = vi.fn().mockReturnValue(false)
const mockInvalidateAppApiKeys = vi.fn()

vi.mock('@/service/use-apps', () => ({
  useAppApiKeys: (_appId: string, _options: unknown) => ({
    data: mockAppApiKeysData(),
    isLoading: mockIsAppApiKeysLoading(),
  }),
  useInvalidateAppApiKeys: () => mockInvalidateAppApiKeys,
}))

const mockDatasetApiKeysData = vi.fn().mockReturnValue({ data: [] })
const mockIsDatasetApiKeysLoading = vi.fn().mockReturnValue(false)
const mockInvalidateDatasetApiKeys = vi.fn()

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiKeys: (_options: unknown) => ({
    data: mockDatasetApiKeysData(),
    isLoading: mockIsDatasetApiKeysLoading(),
  }),
  useInvalidateDatasetApiKeys: () => mockInvalidateDatasetApiKeys,
}))

describe('SecretKeyModal', () => {
  const defaultProps = {
    isShow: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Suppress expected React act() warnings from Headless UI Dialog transitions and async API state updates
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockCurrentWorkspace.mockReturnValue({ id: 'workspace-1', name: 'Test Workspace' })
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockAppApiKeysData.mockReturnValue({ data: [] })
    mockIsAppApiKeysLoading.mockReturnValue(false)
    mockDatasetApiKeysData.mockReturnValue({ data: [] })
    mockIsDatasetApiKeysLoading.mockReturnValue(false)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('rendering when shown', () => {
    it('should render the modal when isShow is true', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    it('should render the tips text', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKeyTips')).toBeInTheDocument()
    })

    it('should render the create new key button', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.createNewSecretKey')).toBeInTheDocument()
    })

    it('should render the close icon', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      expect(closeIcon).toBeInTheDocument()
    })
  })

  describe('rendering when hidden', () => {
    it('should not render content when isShow is false', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} isShow={false} />)
      expect(screen.queryByText('appApi.apiKeyModal.apiSecretKey')).not.toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('should show loading when app API keys are loading', async () => {
      mockIsAppApiKeysLoading.mockReturnValue(true)
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should show loading when dataset API keys are loading', async () => {
      mockIsDatasetApiKeysLoading.mockReturnValue(true)
      await renderModal(<SecretKeyModal {...defaultProps} />)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should not show loading when data is loaded', async () => {
      mockIsAppApiKeysLoading.mockReturnValue(false)
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('API keys list for app', () => {
    const apiKeys = [
      { id: 'key-1', token: 'sk-abc123def456ghi789', created_at: 1700000000, last_used_at: 1700100000 },
      { id: 'key-2', token: 'sk-xyz987wvu654tsr321', created_at: 1700050000, last_used_at: null },
    ]

    beforeEach(() => {
      mockAppApiKeysData.mockReturnValue({ data: apiKeys })
    })

    it('should render API keys when available', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.getByText('sk-...k-abc123def456ghi789')).toBeInTheDocument()
    })

    it('should render created time for keys', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.getByText('Formatted: 1700000000')).toBeInTheDocument()
    })

    it('should render last used time for keys', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.getByText('Formatted: 1700100000')).toBeInTheDocument()
    })

    it('should render "never" for keys without last_used_at', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.getByText('appApi.never')).toBeInTheDocument()
    })

    it('should render delete button for managers', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
      const deleteIcon = document.body.querySelector('svg[class*="h-4"][class*="w-4"]')
      expect(deleteIcon).toBeInTheDocument()
    })

    it('should not render delete button for non-managers', async () => {
      mockIsCurrentWorkspaceManager.mockReturnValue(false)
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      const actionButtons = screen.getAllByRole('button')
      expect(actionButtons.length).toBeGreaterThan(0)
    })

    it('should render table headers', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)
      expect(screen.getByText('appApi.apiKeyModal.secretKey')).toBeInTheDocument()
      expect(screen.getByText('appApi.apiKeyModal.created')).toBeInTheDocument()
      expect(screen.getByText('appApi.apiKeyModal.lastUsed')).toBeInTheDocument()
    })
  })

  describe('API keys list for dataset', () => {
    const datasetKeys = [
      { id: 'dk-1', token: 'dk-abc123def456ghi789', created_at: 1700000000, last_used_at: 1700100000 },
    ]

    beforeEach(() => {
      mockDatasetApiKeysData.mockReturnValue({ data: datasetKeys })
    })

    it('should render dataset API keys when no appId', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      expect(screen.getByText('dk-...k-abc123def456ghi789')).toBeInTheDocument()
    })
  })

  describe('close functionality', () => {
    it('should call onClose when X icon is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onClose = vi.fn()
      await renderModal(<SecretKeyModal {...defaultProps} onClose={onClose} />)

      const closeIcon = document.body.querySelector('svg.cursor-pointer')
      expect(closeIcon).toBeInTheDocument()

      await act(async () => {
        await user.click(closeIcon!)
      })

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('create new key', () => {
    it('should call create API for app when button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey')
      await act(async () => {
        await user.click(createButton)
      })

      await waitFor(() => {
        expect(mockCreateAppApikey).toHaveBeenCalledWith({
          url: '/apps/app-123/api-keys',
          body: {},
        })
      })
    })

    it('should call create API for dataset when no appId', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey')
      await act(async () => {
        await user.click(createButton)
      })

      await waitFor(() => {
        expect(mockCreateDatasetApikey).toHaveBeenCalledWith({
          url: '/datasets/api-keys',
          body: {},
        })
      })
    })

    it('should show generate modal after creating key', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey')
      await act(async () => {
        await user.click(createButton)
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.apiKeyModal.generateTips')).toBeInTheDocument()
      })
    })

    it('should invalidate app API keys after creating', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey')
      await act(async () => {
        await user.click(createButton)
      })

      await waitFor(() => {
        expect(mockInvalidateAppApiKeys).toHaveBeenCalledWith('app-123')
      })
    })

    it('should invalidate dataset API keys after creating (no appId)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey')
      await act(async () => {
        await user.click(createButton)
      })

      await waitFor(() => {
        expect(mockInvalidateDatasetApiKeys).toHaveBeenCalled()
      })
    })

    it('should disable create button when no workspace', async () => {
      mockCurrentWorkspace.mockReturnValue(null)
      await renderModal(<SecretKeyModal {...defaultProps} />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey').closest('button')
      expect(createButton).toBeDisabled()
    })

    it('should disable create button when not editor', async () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)
      await renderModal(<SecretKeyModal {...defaultProps} />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey').closest('button')
      expect(createButton).toBeDisabled()
    })
  })

  describe('delete key', () => {
    const apiKeys = [
      { id: 'key-1', token: 'sk-abc123def456ghi789', created_at: 1700000000, last_used_at: 1700100000 },
    ]

    beforeEach(() => {
      mockAppApiKeysData.mockReturnValue({ data: apiKeys })
    })

    it('should render delete button for managers', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const actionButtons = screen.getAllByRole('button')
      expect(actionButtons.length).toBeGreaterThanOrEqual(3)
    })

    it('should render API key row with actions', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      expect(screen.getByText('sk-...k-abc123def456ghi789')).toBeInTheDocument()
    })

    it('should have action buttons in the key row', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const actionContainers = document.body.querySelectorAll('[class*="space-x-2"]')
      expect(actionContainers.length).toBeGreaterThan(0)
    })

    it('should have delete button visible for managers', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const deleteIcon = document.body.querySelector('svg[class*="h-4"][class*="w-4"]')
      const deleteButton = deleteIcon?.closest('button')
      expect(deleteButton).toBeInTheDocument()
    })

    it('should show confirm dialog when delete button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const actionButtons = document.body.querySelectorAll('button.action-btn')
      const deleteButton = actionButtons[1]
      expect(deleteButton).toBeInTheDocument()

      await act(async () => {
        await user.click(deleteButton!)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTitle')).toBeInTheDocument()
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTips')).toBeInTheDocument()
      })
      await flushTransitions()
    })

    it('should call delete API for app when confirmed', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const actionButtons = document.body.querySelectorAll('button.action-btn')
      const deleteButton = actionButtons[1]
      await act(async () => {
        await user.click(deleteButton!)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTitle')).toBeInTheDocument()
      })
      await flushTransitions()

      const confirmButton = screen.getByText('common.operation.confirm')
      await act(async () => {
        await user.click(confirmButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(mockDelAppApikey).toHaveBeenCalledWith({
          url: '/apps/app-123/api-keys/key-1',
          params: {},
        })
      })
    })

    it('should invalidate app API keys after deleting', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const actionButtons = document.body.querySelectorAll('button.action-btn')
      const deleteButton = actionButtons[1]
      await act(async () => {
        await user.click(deleteButton!)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTitle')).toBeInTheDocument()
      })
      await flushTransitions()

      const confirmButton = screen.getByText('common.operation.confirm')
      await act(async () => {
        await user.click(confirmButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(mockInvalidateAppApiKeys).toHaveBeenCalledWith('app-123')
      })
    })

    it('should close confirm dialog and clear delKeyId when cancel is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const actionButtons = document.body.querySelectorAll('button.action-btn')
      const deleteButton = actionButtons[1]
      await act(async () => {
        await user.click(deleteButton!)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTitle')).toBeInTheDocument()
      })
      await flushTransitions()

      const cancelButton = screen.getByText('common.operation.cancel')
      await act(async () => {
        await user.click(cancelButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.queryByText('appApi.actionMsg.deleteConfirmTitle')).not.toBeInTheDocument()
      })

      expect(mockDelAppApikey).not.toHaveBeenCalled()
    })
  })

  describe('delete key for dataset', () => {
    const datasetKeys = [
      { id: 'dk-1', token: 'dk-abc123def456ghi789', created_at: 1700000000, last_used_at: 1700100000 },
    ]

    beforeEach(() => {
      mockDatasetApiKeysData.mockReturnValue({ data: datasetKeys })
    })

    it('should call delete API for dataset when no appId', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} />)

      const actionButtons = document.body.querySelectorAll('button.action-btn')
      const deleteButton = actionButtons[1]
      await act(async () => {
        await user.click(deleteButton!)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTitle')).toBeInTheDocument()
      })
      await flushTransitions()

      const confirmButton = screen.getByText('common.operation.confirm')
      await act(async () => {
        await user.click(confirmButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(mockDelDatasetApikey).toHaveBeenCalledWith({
          url: '/datasets/api-keys/dk-1',
          params: {},
        })
      })
    })

    it('should invalidate dataset API keys after deleting', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} />)

      const actionButtons = document.body.querySelectorAll('button.action-btn')
      const deleteButton = actionButtons[1]
      await act(async () => {
        await user.click(deleteButton!)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.actionMsg.deleteConfirmTitle')).toBeInTheDocument()
      })
      await flushTransitions()

      const confirmButton = screen.getByText('common.operation.confirm')
      await act(async () => {
        await user.click(confirmButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(mockInvalidateDatasetApiKeys).toHaveBeenCalled()
      })
    })
  })

  describe('token truncation', () => {
    it('should truncate token correctly', async () => {
      const apiKeys = [
        { id: 'key-1', token: 'sk-abcdefghijklmnopqrstuvwxyz1234567890', created_at: 1700000000, last_used_at: null },
      ]
      mockAppApiKeysData.mockReturnValue({ data: apiKeys })

      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      expect(screen.getByText('sk-...qrstuvwxyz1234567890')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should render modal with expected structure', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    it('should render create button with flex styling', async () => {
      await renderModal(<SecretKeyModal {...defaultProps} />)
      const flexContainers = document.body.querySelectorAll('[class*="flex"]')
      expect(flexContainers.length).toBeGreaterThan(0)
    })
  })

  describe('empty state', () => {
    it('should not render table when no keys', async () => {
      mockAppApiKeysData.mockReturnValue({ data: [] })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      expect(screen.queryByText('appApi.apiKeyModal.secretKey')).not.toBeInTheDocument()
    })

    it('should not render table when data is null', async () => {
      mockAppApiKeysData.mockReturnValue(null)
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      expect(screen.queryByText('appApi.apiKeyModal.secretKey')).not.toBeInTheDocument()
    })
  })

  describe('SecretKeyGenerateModal', () => {
    it('should close generate modal on close', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderModal(<SecretKeyModal {...defaultProps} appId="app-123" />)

      const createButton = screen.getByText('appApi.apiKeyModal.createNewSecretKey')
      await act(async () => {
        await user.click(createButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.getByText('appApi.apiKeyModal.generateTips')).toBeInTheDocument()
      })

      const okButton = screen.getByText('appApi.actionMsg.ok')
      await act(async () => {
        await user.click(okButton)
        vi.runAllTimers()
      })

      await waitFor(() => {
        expect(screen.queryByText('appApi.apiKeyModal.generateTips')).not.toBeInTheDocument()
      })
    })
  })
})
