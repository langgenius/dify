/**
 * Integration test: API Key management flow
 *
 * Tests the cross-component interaction:
 *   ApiServer → SecretKeyButton → SecretKeyModal
 *
 * Renders real ApiServer, SecretKeyButton, and SecretKeyModal together
 * with only service-layer mocks. Deep modal interactions (create/delete)
 * are covered by unit tests in secret-key-modal.spec.tsx.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ApiServer from '@/app/components/develop/ApiServer'

// ---------- fake timers (HeadlessUI Dialog transitions) ----------
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

async function flushUI() {
  await act(async () => {
    vi.runAllTimers()
  })
}

// ---------- mocks ----------

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Workspace' },
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: vi.fn((val: number) => `Time:${val}`),
    formatDate: vi.fn((val: string) => `Date:${val}`),
  }),
}))

vi.mock('@/service/apps', () => ({
  createApikey: vi.fn().mockResolvedValue({ token: 'sk-new-token-1234567890abcdef' }),
  delApikey: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/datasets', () => ({
  createApikey: vi.fn().mockResolvedValue({ token: 'dk-new' }),
  delApikey: vi.fn().mockResolvedValue({}),
}))

const mockApiKeys = vi.fn().mockReturnValue({ data: [] })
const mockIsLoading = vi.fn().mockReturnValue(false)

vi.mock('@/service/use-apps', () => ({
  useAppApiKeys: () => ({
    data: mockApiKeys(),
    isLoading: mockIsLoading(),
  }),
  useInvalidateAppApiKeys: () => vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiKeys: () => ({ data: null, isLoading: false }),
  useInvalidateDatasetApiKeys: () => vi.fn(),
}))

// ---------- tests ----------

describe('API Key management flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiKeys.mockReturnValue({ data: [] })
    mockIsLoading.mockReturnValue(false)
  })

  it('ApiServer renders URL, status badge, and API Key button', () => {
    render(<ApiServer apiBaseUrl="https://api.dify.ai/v1" appId="app-1" />)

    expect(screen.getByText('https://api.dify.ai/v1')).toBeInTheDocument()
    expect(screen.getByText('appApi.ok')).toBeInTheDocument()
    expect(screen.getByText('appApi.apiKey')).toBeInTheDocument()
  })

  it('clicking API Key button opens SecretKeyModal with real modal content', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<ApiServer apiBaseUrl="https://api.dify.ai/v1" appId="app-1" />)

    // Click API Key button (rendered by SecretKeyButton)
    await act(async () => {
      await user.click(screen.getByText('appApi.apiKey'))
    })
    await flushUI()

    // SecretKeyModal should render with real HeadlessUI Dialog
    await waitFor(() => {
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKeyTips')).toBeInTheDocument()
      expect(screen.getByText('appApi.apiKeyModal.createNewSecretKey')).toBeInTheDocument()
    })
  })

  it('modal shows loading state when API keys are being fetched', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockIsLoading.mockReturnValue(true)

    render(<ApiServer apiBaseUrl="https://api.dify.ai/v1" appId="app-1" />)

    await act(async () => {
      await user.click(screen.getByText('appApi.apiKey'))
    })
    await flushUI()

    await waitFor(() => {
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    // Loading indicator should be present
    expect(document.body.querySelector('[role="status"]')).toBeInTheDocument()
  })

  it('modal can be closed by clicking X icon', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<ApiServer apiBaseUrl="https://api.dify.ai/v1" appId="app-1" />)

    // Open modal
    await act(async () => {
      await user.click(screen.getByText('appApi.apiKey'))
    })
    await flushUI()

    await waitFor(() => {
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    // Click X icon to close
    const closeIcon = document.body.querySelector('svg.cursor-pointer')
    expect(closeIcon).toBeInTheDocument()

    await act(async () => {
      await user.click(closeIcon!)
    })
    await flushUI()

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('appApi.apiKeyModal.apiSecretKeyTips')).not.toBeInTheDocument()
    })
  })

  it('renders correctly with different API URLs', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const { rerender } = render(
      <ApiServer apiBaseUrl="http://localhost:5001/v1" appId="app-dev" />,
    )

    expect(screen.getByText('http://localhost:5001/v1')).toBeInTheDocument()

    // Open modal and verify it works with the same appId
    await act(async () => {
      await user.click(screen.getByText('appApi.apiKey'))
    })
    await flushUI()

    await waitFor(() => {
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })

    // Close modal, update URL and re-verify
    const xIcon = document.body.querySelector('svg.cursor-pointer')
    await act(async () => {
      await user.click(xIcon!)
    })
    await flushUI()

    rerender(
      <ApiServer apiBaseUrl="https://api.production.com/v1" appId="app-prod" />,
    )

    expect(screen.getByText('https://api.production.com/v1')).toBeInTheDocument()
  })
})
