import type { AppDetailResponse } from '@/models/app'
import type { SystemFeatures } from '@/types/feature'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import { basePath } from '@/utils/var'
import AppCard from '..'

const mockPush = vi.fn()
const mockFetchAppDetailDirect = vi.fn()
const mockSetAppDetail = vi.fn()
const mockWindowOpen = vi.fn()

let mockAppDetail: AppDetailResponse | undefined
let mockSystemFeatures: SystemFeatures
let mockAccessSubjects: { groups?: Array<{ id: string }>, members?: Array<{ id: string }> } | undefined
let mockWorkflowData: { graph?: { nodes?: Array<{ data: { type: string } }> } } | undefined
let mockAppContext: { isCurrentWorkspaceManager: boolean, isCurrentWorkspaceEditor: boolean }
let mockPathname = '/apps/app-1/overview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValueOrOptions?: unknown, maybeOptions?: { ns?: string }) => {
      const options = typeof defaultValueOrOptions === 'object' && defaultValueOrOptions && 'ns' in (defaultValueOrOptions as object)
        ? defaultValueOrOptions as { ns?: string }
        : maybeOptions

      return options?.ns ? `${options.ns}.${key}` : key
    },
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail?: AppDetailResponse, setAppDetail: typeof mockSetAppDetail }) => unknown) => selector({
    appDetail: mockAppDetail,
    setAppDetail: mockSetAppDetail,
  }),
}))

vi.mock('@/app/components/app-sidebar/basic', () => ({
  default: ({ name, type }: { name: string, type: string }) => (
    <div data-testid="app-basic">
      <div>{name}</div>
      <div>{type}</div>
    </div>
  ),
}))

vi.mock('@/app/components/develop/secret-key/secret-key-button', () => ({
  default: ({ appId }: { appId: string }) => <div>{`secret-key:${appId}`}</div>,
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div>{`indicator:${color}`}</div>,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppContext,
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: SystemFeatures }) => unknown) => selector({
    systemFeatures: mockSystemFeatures,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
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

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: mockWorkflowData,
  }),
}))

vi.mock('../../settings', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => isShow
    ? (
        <div>
          <div>settings-modal</div>
          <button onClick={onClose}>close-settings</button>
        </div>
      )
    : null,
}))

vi.mock('../../embedded', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => isShow
    ? (
        <div>
          <div>embedded-modal</div>
          <button onClick={onClose}>close-embedded</button>
        </div>
      )
    : null,
}))

vi.mock('../../customize', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => isShow
    ? (
        <div>
          <div>customize-modal</div>
          <button onClick={onClose}>close-customize</button>
        </div>
      )
    : null,
}))

vi.mock('../../../app-access-control', () => ({
  default: ({ onConfirm, onClose }: { onConfirm: () => void, onClose: () => void }) => (
    <div>
      <div>access-control-modal</div>
      <button onClick={onConfirm}>confirm-access</button>
      <button onClick={onClose}>close-access</button>
    </div>
  ),
}))

const createSystemFeatures = (overrides: Partial<SystemFeatures> = {}): SystemFeatures => ({
  ...defaultSystemFeatures,
  ...overrides,
  webapp_auth: {
    ...defaultSystemFeatures.webapp_auth,
    ...overrides.webapp_auth,
    sso_config: {
      ...defaultSystemFeatures.webapp_auth.sso_config,
      ...overrides.webapp_auth?.sso_config,
    },
  },
})

const createAppInfo = (overrides: Partial<AppDetailResponse> = {}): AppDetailResponse => ({
  access_mode: AccessMode.PUBLIC,
  api_base_url: 'https://api.example.com',
  enable_api: true,
  enable_site: true,
  icon: '🤖',
  icon_background: '#ffffff',
  icon_type: 'emoji',
  id: 'app-1',
  mode: AppModeEnum.CHAT,
  name: 'Test app',
  site: {
    app_base_url: 'https://apps.example.com',
    access_token: 'token-123',
  },
  ...overrides,
} as AppDetailResponse)

describe('AppCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetail = createAppInfo()
    mockSystemFeatures = createSystemFeatures({
      webapp_auth: {
        ...defaultSystemFeatures.webapp_auth,
        enabled: true,
      },
    })
    mockAccessSubjects = {
      groups: [{ id: 'group-1' }],
      members: [],
    }
    mockWorkflowData = undefined
    mockAppContext = {
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    }
    mockPathname = '/apps/app-1/overview'
    window.open = mockWindowOpen as unknown as typeof window.open
  })

  it('should render the webapp card with address, access, and operations', () => {
    render(
      <AppCard
        appInfo={createAppInfo()}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('appOverview.overview.appInfo.title')).toBeInTheDocument()
    expect(screen.getByText('indicator:green')).toBeInTheDocument()
    expect(screen.getByText(`https://apps.example.com${basePath}/chat/token-123`)).toBeInTheDocument()
    expect(screen.getByText('app.accessControlDialog.accessItems.anyone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /appOverview\.overview\.appInfo\.launch/i })).not.toBeDisabled()
  })

  it('should open customize, settings, and embedded modals from operations', () => {
    render(
      <AppCard
        appInfo={createAppInfo()}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /appOverview\.overview\.appInfo\.settings\.entry/i }))
    expect(screen.getByText('settings-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-settings'))
    expect(screen.queryByText('settings-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /appOverview\.overview\.appInfo\.customize\.entry/i }))
    expect(screen.getByText('customize-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-customize'))
    expect(screen.queryByText('customize-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /appOverview\.overview\.appInfo\.embedded\.entry/i }))
    expect(screen.getByText('embedded-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-embedded'))
    expect(screen.queryByText('embedded-modal')).not.toBeInTheDocument()
  })

  it('should open the regenerate dialog and confirm code regeneration', async () => {
    const onGenerateCode = vi.fn().mockResolvedValue(undefined)

    render(
      <AppCard
        appInfo={createAppInfo()}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
        onGenerateCode={onGenerateCode}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /appOverview\.overview\.appInfo\.regenerate/i }))
    expect(screen.getByText('appOverview.overview.appInfo.regenerateNotice')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
    await waitFor(() => {
      expect(screen.queryByText('appOverview.overview.appInfo.regenerateNotice')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /appOverview\.overview\.appInfo\.regenerate/i }))

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))

    await waitFor(() => {
      expect(onGenerateCode).toHaveBeenCalledTimes(1)
    })
  })

  it('should route api cards to the develop page and render the secret key button', () => {
    render(
      <AppCard
        appInfo={createAppInfo()}
        cardType="api"
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('secret-key:app-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /appOverview\.overview\.apiInfo\.doc/i }))

    expect(mockPush).toHaveBeenCalledWith('/apps/app-1/develop')
  })

  it('should open the access-control modal and refresh app detail after confirm', async () => {
    mockAppDetail = createAppInfo({
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    })
    mockFetchAppDetailDirect.mockResolvedValue(createAppInfo({
      id: 'app-2',
      access_mode: AccessMode.PUBLIC,
    }))

    render(
      <AppCard
        appInfo={createAppInfo({
          access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
        })}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    fireEvent.click(screen.getByText('app.accessControlDialog.accessItems.specific'))
    expect(screen.getByText('access-control-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-access'))
    expect(screen.queryByText('access-control-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('app.accessControlDialog.accessItems.specific'))

    fireEvent.click(screen.getByText('confirm-access'))

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetAppDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'app-2' }))
    })
  })

  it('should render a disabled overlay when trigger mode blocks the card', () => {
    const { container } = render(
      <AppCard
        appInfo={createAppInfo()}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
        triggerModeDisabled
        triggerModeMessage={<span>blocked-in-trigger-mode</span>}
      />,
    )

    expect(container.querySelector('.cursor-not-allowed')).toBeInTheDocument()
  })
})
