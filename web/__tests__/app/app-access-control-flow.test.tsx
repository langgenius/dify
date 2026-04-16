import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppPublisher from '@/app/components/app/app-publisher'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'

const mockFetchAppDetailDirect = vi.fn()
const mockSetAppDetail = vi.fn()
const mockRefetch = vi.fn()

let mockAppDetail: {
  id: string
  name: string
  mode: AppModeEnum
  access_mode: AccessMode
  description: string
  icon: string
  icon_type: string
  icon_background: string
  site: {
    app_base_url: string
    access_token: string
  }
} | null = null

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: mockAppDetail,
    setAppDetail: mockSetAppDetail,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    systemFeatures: {
      webapp_auth: {
        enabled: true,
      },
    },
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (value: number) => `ago:${value}`,
  }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => ({
    data: { result: true },
    isLoading: false,
    refetch: mockRefetch,
  }),
  useAppWhiteListSubjects: () => ({
    data: { groups: [], members: [] },
    isLoading: false,
  }),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

vi.mock('@/app/components/app/overview/embedded', () => ({
  default: () => null,
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: vi.fn(() => null),
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppPublishUpdate: vi.fn(() => vi.fn()),
  },
}))

vi.mock('@/app/components/app/app-access-control', () => ({
  default: ({
    onConfirm,
    onClose,
  }: {
    onConfirm: () => Promise<void>
    onClose: () => void
  }) => (
    <div data-testid="access-control-modal">
      <button type="button" onClick={() => void onConfirm()}>confirm-access-control</button>
      <button type="button" onClick={onClose}>close-access-control</button>
    </div>
  ),
}))

describe('App Access Control Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetail = {
      id: 'app-1',
      name: 'Demo App',
      mode: AppModeEnum.CHAT,
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      description: 'Demo app description',
      icon: '🤖',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
      site: {
        app_base_url: 'https://example.com',
        access_token: 'token-1',
      },
    }
    mockFetchAppDetailDirect.mockResolvedValue({
      ...mockAppDetail,
      access_mode: AccessMode.PUBLIC,
    })
  })

  it('refreshes app detail after confirming access control updates', async () => {
    renderWithQueryClient(<AppPublisher publishedAt={1700000000} />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    fireEvent.click(screen.getByText('app.accessControlDialog.accessItems.specific'))

    expect(screen.getByTestId('access-control-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'confirm-access-control' }))

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetAppDetail).toHaveBeenCalledWith(expect.objectContaining({
        id: 'app-1',
        access_mode: AccessMode.PUBLIC,
      }))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('access-control-modal')).not.toBeInTheDocument()
    })
  })
})
