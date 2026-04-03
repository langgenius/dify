import type { ReactNode } from 'react'
import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import AppCard from '../app-card'

const mockFetchAppDetailDirect = vi.fn()
const mockPush = vi.fn()
const mockSetAppDetail = vi.fn()
const mockOnChangeStatus = vi.fn()
const mockOnGenerateCode = vi.fn()

let mockWorkflow: { graph?: { nodes?: Array<{ data?: { type?: string } }> } } | null = null
let mockAccessSubjects: { groups?: unknown[], members?: unknown[] } = { groups: [], members: [] }
let mockAppDetail: AppDetailResponse | undefined

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
    langGeniusVersionInfo: {
      current_env: 'TESTING',
    },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { webapp_auth: { enabled: boolean } } }) => unknown) => selector({
    systemFeatures: {
      webapp_auth: {
        enabled: true,
      },
    },
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: AppDetailResponse, setAppDetail: typeof mockSetAppDetail }) => unknown) => selector({
    appDetail: mockAppDetail as AppDetailResponse,
    setAppDetail: mockSetAppDetail,
  }),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/overview',
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: mockWorkflow,
  }),
}))

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: () => ({
    data: mockAccessSubjects,
  }),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

vi.mock('@/app/components/develop/secret-key/secret-key-button', () => ({
  default: ({ appId }: { appId: string }) => <div data-testid="secret-key-button">{appId}</div>,
}))

vi.mock('../settings', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => isShow ? <button data-testid="settings-modal" onClick={onClose}>settings-modal</button> : null,
}))

vi.mock('../embedded', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => isShow ? <button data-testid="embedded-modal" onClick={onClose}>embedded-modal</button> : null,
}))

vi.mock('../customize', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => isShow ? <button data-testid="customize-modal" onClick={onClose}>customize-modal</button> : null,
}))

vi.mock('../../app-access-control', () => ({
  default: ({ onConfirm, onClose }: { onConfirm: () => Promise<void>, onClose: () => void }) => (
    <div data-testid="access-control-modal">
      <button onClick={() => void onConfirm()}>confirm-access-control</button>
      <button onClick={onClose}>close-access-control</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: ReactNode, popupContent?: ReactNode }) => (
    <div>
      {children}
      {popupContent}
    </div>
  ),
}))

const mockWindowOpen = vi.fn()
Object.defineProperty(window, 'open', {
  writable: true,
  value: mockWindowOpen,
})

describe('AppCard', () => {
  const appInfo = {
    id: 'app-1',
    mode: AppModeEnum.CHAT,
    enable_site: true,
    enable_api: true,
    icon: 'app-icon',
    icon_background: '#fff',
    api_base_url: 'https://api.example.com',
    site: {
      app_base_url: 'https://example.com',
      access_token: 'access-token',
    },
  } as AppDetailResponse

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetail = {
      id: 'app-1',
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      site: {
        app_base_url: 'https://example.com',
        access_token: 'access-token',
      },
    } as AppDetailResponse
    mockWorkflow = {
      graph: {
        nodes: [{ data: { type: 'start' } }],
      },
    }
    mockAccessSubjects = {
      groups: [],
      members: [],
    }
    mockFetchAppDetailDirect.mockResolvedValue({
      id: 'app-1',
      access_mode: AccessMode.PUBLIC,
    })
  })

  it('should open the published webapp when launch is clicked', () => {
    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    fireEvent.click(screen.getByText('overview.appInfo.launch'))

    expect(mockWindowOpen).toHaveBeenCalledWith(`https://example.com${basePath}/chat/access-token`, '_blank')
  })

  it('should show the access-control not-set badge when specific access has no subjects', () => {
    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    expect(screen.getByText('publishApp.notSet')).toBeInTheDocument()
  })

  it('should hide the address and operation sections for unpublished workflows', () => {
    mockWorkflow = null

    render(
      <AppCard
        appInfo={{
          ...appInfo,
          mode: AppModeEnum.WORKFLOW,
        }}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    expect(screen.queryByText('overview.appInfo.accessibleAddress')).not.toBeInTheDocument()
    expect(screen.queryByText('overview.appInfo.launch')).not.toBeInTheDocument()
    expect(screen.getByText('overview.status.disable')).toBeInTheDocument()
  })

  it('should render api operations and navigate to the develop page', () => {
    render(
      <AppCard
        appInfo={{
          ...appInfo,
          mode: AppModeEnum.COMPLETION,
        }}
        cardType="api"
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    expect(screen.getByTestId('secret-key-button')).toHaveTextContent('app-1')

    fireEvent.click(screen.getByText('overview.apiInfo.doc'))

    expect(mockPush).toHaveBeenCalledWith('/app/app-1/develop')
  })

  it('should open settings embedded and customize dialogs from webapp operations', () => {
    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    fireEvent.click(screen.getByText('overview.appInfo.embedded.entry'))
    expect(screen.getByTestId('embedded-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('overview.appInfo.customize.entry'))
    expect(screen.getByTestId('customize-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('overview.appInfo.settings.entry'))
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument()
  })

  it('should refresh app detail after confirming access control changes', async () => {
    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
        onGenerateCode={mockOnGenerateCode}
      />,
    )

    fireEvent.click(screen.getByText('publishApp.notSet'))
    expect(screen.getByTestId('access-control-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('confirm-access-control'))

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetAppDetail).toHaveBeenCalledWith({
        id: 'app-1',
        access_mode: AccessMode.PUBLIC,
      })
    })
  })

  it('should surface the learn-more tooltip action for workflows without a start node', () => {
    mockWorkflow = {
      graph: {
        nodes: [{ data: { type: 'llm' } }],
      },
    }

    render(
      <AppCard
        appInfo={{
          ...appInfo,
          mode: AppModeEnum.WORKFLOW,
        }}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    fireEvent.click(screen.getByText('overview.appInfo.enableTooltip.learnMore'))

    expect(mockWindowOpen).toHaveBeenCalledWith('https://docs.example.com/use-dify/nodes/user-input', '_blank')
  })

  it('should close the overview dialogs when their child callbacks are invoked', () => {
    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    fireEvent.click(screen.getByText('overview.appInfo.embedded.entry'))
    fireEvent.click(screen.getByTestId('embedded-modal'))
    expect(screen.queryByTestId('embedded-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('overview.appInfo.customize.entry'))
    fireEvent.click(screen.getByTestId('customize-modal'))
    expect(screen.queryByTestId('customize-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('overview.appInfo.settings.entry'))
    fireEvent.click(screen.getByTestId('settings-modal'))
    expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('publishApp.notSet'))
    fireEvent.click(screen.getByText('close-access-control'))
    expect(screen.queryByTestId('access-control-modal')).not.toBeInTheDocument()
  })

  it('should report refresh failures from access control updates', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchAppDetailDirect.mockRejectedValueOnce(new Error('refresh failed'))

    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    fireEvent.click(screen.getByText('publishApp.notSet'))
    fireEvent.click(screen.getByText('confirm-access-control'))

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch app detail:', expect.any(Error))
    })

    consoleErrorSpy.mockRestore()
  })

  it('should close the regenerate confirmation even when no generator is configured', () => {
    const { container } = render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    const refreshButton = container.querySelector('[class*="refreshIcon"]')?.parentElement as HTMLElement
    fireEvent.click(refreshButton)
    expect(screen.getByText('overview.appInfo.regenerateNotice')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

    expect(mockOnGenerateCode).not.toHaveBeenCalled()
    return waitFor(() => {
      expect(screen.queryByText('overview.appInfo.regenerateNotice')).not.toBeInTheDocument()
    })
  })

  it('should regenerate accessible urls when a generator is configured', async () => {
    mockOnGenerateCode.mockResolvedValue(undefined)
    const { container } = render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
        onGenerateCode={mockOnGenerateCode}
      />,
    )

    const refreshButton = container.querySelector('[class*="refreshIcon"]')?.parentElement as HTMLElement
    fireEvent.click(refreshButton)
    fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

    await waitFor(() => {
      expect(mockOnGenerateCode).toHaveBeenCalledTimes(1)
    })
  })
})
