/**
 * Integration test: DevelopMain page flow
 *
 * Tests the full page lifecycle:
 *   Loading state → App loaded → Header (ApiServer) + Content (Doc) rendered
 *
 * Uses real DevelopMain, ApiServer, and Doc components with minimal mocks.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DevelopMain from '@/app/components/develop'
import { AppModeEnum, Theme } from '@/types/app'

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

let storeAppDetail: unknown

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    return selector({ appDetail: storeAppDetail })
  },
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: Theme.light }),
}))

vi.mock('@/i18n-config/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n-config/language')>()
  return {
    ...actual,
  }
})

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
  createApikey: vi.fn().mockResolvedValue({ token: 'sk-new-1234567890' }),
  delApikey: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/datasets', () => ({
  createApikey: vi.fn().mockResolvedValue({ token: 'dk-new' }),
  delApikey: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/use-apps', () => ({
  useAppApiKeys: () => ({ data: { data: [] }, isLoading: false }),
  useInvalidateAppApiKeys: () => vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiKeys: () => ({ data: null, isLoading: false }),
  useInvalidateDatasetApiKeys: () => vi.fn(),
}))

// ---------- tests ----------

describe('DevelopMain page flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeAppDetail = undefined
  })

  it('should show loading indicator when appDetail is not available', () => {
    storeAppDetail = undefined
    render(<DevelopMain appId="app-1" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    // No content should be visible
    expect(screen.queryByText('appApi.apiServer')).not.toBeInTheDocument()
  })

  it('should render full page when appDetail is loaded', () => {
    storeAppDetail = {
      id: 'app-1',
      name: 'Test App',
      api_base_url: 'https://api.test.com/v1',
      mode: AppModeEnum.CHAT,
    }

    render(<DevelopMain appId="app-1" />)

    // ApiServer section should be visible
    expect(screen.getByText('appApi.apiServer')).toBeInTheDocument()
    expect(screen.getByText('https://api.test.com/v1')).toBeInTheDocument()
    expect(screen.getByText('appApi.ok')).toBeInTheDocument()
    expect(screen.getByText('appApi.apiKey')).toBeInTheDocument()

    // Loading should NOT be visible
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('should render Doc component with correct app mode template', () => {
    storeAppDetail = {
      id: 'app-1',
      name: 'Chat App',
      api_base_url: 'https://api.test.com/v1',
      mode: AppModeEnum.CHAT,
    }

    const { container } = render(<DevelopMain appId="app-1" />)

    // Doc renders an article element with prose classes
    const article = container.querySelector('article')
    expect(article).toBeInTheDocument()
    expect(article?.className).toContain('prose')
  })

  it('should transition from loading to content when appDetail becomes available', () => {
    // Start with no data
    storeAppDetail = undefined
    const { rerender } = render(<DevelopMain appId="app-1" />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Simulate store update
    storeAppDetail = {
      id: 'app-1',
      name: 'My App',
      api_base_url: 'https://api.example.com/v1',
      mode: AppModeEnum.COMPLETION,
    }
    rerender(<DevelopMain appId="app-1" />)

    // Content should now be visible
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('https://api.example.com/v1')).toBeInTheDocument()
  })

  it('should open API key modal from the page', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    storeAppDetail = {
      id: 'app-1',
      name: 'Test App',
      api_base_url: 'https://api.test.com/v1',
      mode: AppModeEnum.WORKFLOW,
    }

    render(<DevelopMain appId="app-1" />)

    // Click API Key button in the header
    await act(async () => {
      await user.click(screen.getByText('appApi.apiKey'))
    })
    await flushUI()

    // SecretKeyModal should open
    await waitFor(() => {
      expect(screen.getByText('appApi.apiKeyModal.apiSecretKey')).toBeInTheDocument()
    })
  })

  it('should render correctly for different app modes', () => {
    const modes = [
      AppModeEnum.CHAT,
      AppModeEnum.COMPLETION,
      AppModeEnum.ADVANCED_CHAT,
      AppModeEnum.WORKFLOW,
    ]

    for (const mode of modes) {
      storeAppDetail = {
        id: 'app-1',
        name: `${mode} App`,
        api_base_url: 'https://api.test.com/v1',
        mode,
      }

      const { container, unmount } = render(<DevelopMain appId="app-1" />)

      // ApiServer should always be present
      expect(screen.getByText('appApi.apiServer')).toBeInTheDocument()

      // Doc should render an article
      expect(container.querySelector('article')).toBeInTheDocument()

      unmount()
    }
  })

  it('should have correct page layout structure', () => {
    storeAppDetail = {
      id: 'app-1',
      name: 'Test App',
      api_base_url: 'https://api.test.com/v1',
      mode: AppModeEnum.CHAT,
    }

    render(<DevelopMain appId="app-1" />)

    // Main container: flex column with full height
    const mainDiv = screen.getByTestId('develop-main')
    expect(mainDiv.className).toContain('flex')
    expect(mainDiv.className).toContain('flex-col')
    expect(mainDiv.className).toContain('h-full')

    // Header section with border
    const header = mainDiv.querySelector('.border-b')
    expect(header).toBeInTheDocument()

    // Content section with overflow scroll
    const content = mainDiv.querySelector('.overflow-auto')
    expect(content).toBeInTheDocument()
  })
})
