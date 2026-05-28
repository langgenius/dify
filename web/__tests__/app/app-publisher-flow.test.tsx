import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import AppPublisher from '@/app/components/app/app-publisher'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'

const mockTrackEvent = vi.fn()
const mockRefetch = vi.fn()
const mockFetchInstalledAppList = vi.fn()
const mockFetchAppDetailDirect = vi.fn()
const mockToastError = vi.fn()
const mockOpenAsyncWindow = vi.fn()
const mockSetAppDetail = vi.fn()

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

const renderWithQueryClient = (ui: React.ReactElement) =>
  renderWithSystemFeatures(ui, {
    systemFeatures: {
      webapp_auth: {
        enabled: true,
      },
    },
  })

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', () => ({
  useKeyPress: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: mockAppDetail,
    setAppDetail: mockSetAppDetail,
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (value: number) => `ago:${value}`,
  }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
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

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: (...args: unknown[]) => mockFetchInstalledAppList(...args),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/app/components/app/overview/embedded', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => (
    isShow
      ? (
          <div data-testid="embedded-modal">
            <button onClick={onClose}>close-embedded</button>
          </div>
        )
      : null
  ),
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
  default: () => <div data-testid="app-access-control" />,
}))

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyCodeBySystem: () => 'ctrl',
  getKeyboardKeyNameBySystem: (key: string) => key,
}))

describe('App Publisher Flow', () => {
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
    mockFetchInstalledAppList.mockResolvedValue({
      installed_apps: [{ id: 'installed-1' }],
    })
    mockFetchAppDetailDirect.mockResolvedValue({
      id: 'app-1',
      access_mode: AccessMode.PUBLIC,
    })
    mockOpenAsyncWindow.mockImplementation(async (
      resolver: () => Promise<string>,
      options?: { onError?: (error: Error) => void },
    ) => {
      try {
        return await resolver()
      }
      catch (error) {
        options?.onError?.(error as Error)
      }
    })
  })

  it('publishes from the summary panel and tracks the publish event', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined)

    renderWithQueryClient(
      <AppPublisher
        publishedAt={1700000000}
        onPublish={onPublish}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))

    expect(screen.getByText('common.latestPublished')).toBeInTheDocument()
    expect(screen.getByText('common.publishUpdate')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.publishUpdate'))

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).toHaveBeenCalledWith('app_published_time', expect.objectContaining({
        action_mode: 'app',
        app_id: 'app-1',
        app_name: 'Demo App',
      }))
    })

    expect(mockRefetch).toHaveBeenCalled()
  })

  it('opens embedded modal and resolves the installed explore target', async () => {
    renderWithQueryClient(<AppPublisher publishedAt={1700000000} />)

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('common.embedIntoSite'))

    expect(screen.getByTestId('embedded-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('common.openInExplore'))

    await waitFor(() => {
      expect(mockFetchInstalledAppList).toHaveBeenCalledWith('app-1')
      expect(mockOpenAsyncWindow).toHaveBeenCalledTimes(1)
    })
  })

  it('shows a toast error when no installed explore app is available', async () => {
    mockFetchInstalledAppList.mockResolvedValue({
      installed_apps: [],
    })

    renderWithQueryClient(<AppPublisher publishedAt={1700000000} />)

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('common.openInExplore'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('No app found in Explore')
    })
  })
})
