import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import AppCard from '../app-card'

const mockPush = vi.fn()
const mockSetAppDetail = vi.fn()
const mockOnChangeStatus = vi.fn()

let mockWorkflow: { graph?: { nodes?: Array<{ data?: { type?: string } }> } } | null = null
let mockAccessSubjects: { groups?: unknown[]; members?: unknown[] } = { groups: [], members: [] }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceEditor: true,
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
    appDetail: {
      id: 'app-1',
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      site: {
        app_base_url: 'https://example.com',
        access_token: 'access-token',
      },
    } as AppDetailResponse,
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
    mockWorkflow = {
      graph: {
        nodes: [{ data: { type: 'start' } }],
      },
    }
    mockAccessSubjects = {
      groups: [],
      members: [],
    }
  })

  it('should open the published webapp when launch is clicked', () => {
    render(
      <AppCard
        appInfo={appInfo}
        onChangeStatus={mockOnChangeStatus}
      />,
    )

    fireEvent.click(screen.getByText('overview.appInfo.launch'))

    expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com/app/chat/access-token', '_blank')
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
})
