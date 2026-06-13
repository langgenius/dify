import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LayoutMain from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/layout-main'
import { useStore as useAppStore } from '@/app/components/app/store'
import { AppModeEnum } from '@/types/app'

const mockFetchAppDetailDirect = vi.fn()
const mockReplace = vi.fn()

let mockPathname = '/app/app-1/configuration'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', () => ({
  useUnmount: (fn: () => void) => {
    useEffect(() => () => fn(), [])
  },
}))

vi.mock('@/app/components/app-sidebar', () => ({
  default: () => <div data-testid="app-sidebar" />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="layout-loading" role="status" />,
}))

vi.mock('@/app/components/base/tag-management/store', () => ({
  useStore: () => false,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
    isLoadingCurrentWorkspace: false,
    currentWorkspace: { id: 'ws-1' },
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/next/dynamic', () => ({
  __esModule: true,
  default: () => () => null,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

describe('App detail layout flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/app/app-1/configuration'
    useAppStore.setState({
      appDetail: undefined,
      appSidebarExpand: '',
      currentLogItem: undefined,
      currentLogModalActiveTab: 'DETAIL',
      showPromptLogModal: false,
      showAgentLogModal: false,
      showMessageLogModal: false,
      showAppConfigureFeaturesModal: false,
    })
    mockFetchAppDetailDirect.mockResolvedValue({
      id: 'app-1',
      name: 'Test App',
      mode: AppModeEnum.CHAT,
      icon: '🤖',
      icon_type: 'emoji',
      icon_background: '#FFF',
    })
  })

  it('should not refetch app detail when only the tab pathname changes', async () => {
    const { rerender } = render(
      <LayoutMain appId="app-1">
        <div>app-detail-content</div>
      </LayoutMain>,
    )

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
      expect(screen.getByText('app-detail-content')).toBeInTheDocument()
    })

    mockPathname = '/app/app-1/logs'

    await act(async () => {
      rerender(
        <LayoutMain appId="app-1">
          <div>app-detail-content</div>
        </LayoutMain>,
      )
    })

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('layout-loading')).not.toBeInTheDocument()
      expect(screen.getByText('app-detail-content')).toBeInTheDocument()
    })
  })
})
