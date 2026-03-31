import type { AppDetailResponse } from '@/models/app'
import type { SystemFeatures } from '@/types/feature'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import { basePath } from '@/utils/var'
import { useAppCard } from '../use-app-card'

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

describe('useAppCard', () => {
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

  it('should build webapp operations and derived labels for a running app', () => {
    const { result } = renderHook(() => useAppCard({
      appInfo: createAppInfo(),
      cardType: 'webapp',
    }))

    expect(result.current.basicName).toBe('appOverview.overview.appInfo.title')
    expect(result.current.basicDescription).toBe('appOverview.overview.appInfo.explanation')
    expect(result.current.addressLabel).toBe('appOverview.overview.appInfo.accessibleAddress')
    expect(result.current.appUrl).toBe(`https://apps.example.com${basePath}/chat/token-123`)
    expect(result.current.learnMoreUrl).toBe('https://docs.example.com/use-dify/nodes/user-input')
    expect(result.current.operations.map(item => item.key)).toEqual(['launch', 'embedded', 'customize', 'settings'])
    expect(result.current.operations.every(item => item.disabled === false)).toBe(true)
  })

  it('should mark workflow cards as minimal when the start node is missing', () => {
    mockWorkflowData = {
      graph: {
        nodes: [{ data: { type: 'llm' } }],
      },
    }

    const { result } = renderHook(() => useAppCard({
      appInfo: createAppInfo({
        mode: AppModeEnum.WORKFLOW,
      }),
      cardType: 'webapp',
    }))

    expect(result.current.isMinimalState).toBe(true)
    expect(result.current.runningStatus).toBe(false)
    expect(result.current.toggleDisabled).toBe(true)
    expect(result.current.missingStartNode).toBe(true)
  })

  it('should open launch links, route api docs, and toggle modal operations', () => {
    const { result } = renderHook(() => useAppCard({
      appInfo: createAppInfo(),
      cardType: 'webapp',
    }))

    act(() => {
      result.current.handleOperationSelect('launch')
      result.current.handleOperationSelect('embedded')
      result.current.handleOperationSelect('settings')
      result.current.handleOperationSelect('customize')
    })

    expect(mockWindowOpen).toHaveBeenCalledWith(`https://apps.example.com${basePath}/chat/token-123`, '_blank')
    expect(result.current.activeModal).toBe('customize')

    const apiHook = renderHook(() => useAppCard({
      appInfo: createAppInfo(),
      cardType: 'api',
    }))

    act(() => {
      apiHook.result.current.handleOperationSelect('doc')
    })

    expect(mockPush).toHaveBeenCalledWith('/apps/app-1/develop')
  })

  it('should run regenerate actions and close the confirmation dialog', async () => {
    const onGenerateCode = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAppCard({
      appInfo: createAppInfo(),
      cardType: 'webapp',
      onGenerateCode,
    }))

    act(() => {
      result.current.setShowConfirmDelete(true)
    })

    await act(async () => {
      await result.current.handleGenerateCode()
    })

    expect(onGenerateCode).toHaveBeenCalledTimes(1)
    expect(result.current.genLoading).toBe(false)
    expect(result.current.showConfirmDelete).toBe(false)
  })

  it('should flag unset specific-group access and refresh app detail after access updates', async () => {
    mockAppDetail = createAppInfo({
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    })
    mockAccessSubjects = {
      groups: [],
      members: [],
    }
    mockFetchAppDetailDirect.mockResolvedValue(createAppInfo({
      id: 'app-2',
      access_mode: AccessMode.PUBLIC,
    }))

    const { result } = renderHook(() => useAppCard({
      appInfo: mockAppDetail!,
      cardType: 'webapp',
    }))

    expect(result.current.isAppAccessSet).toBe(false)
    expect(result.current.accessDisplay).toMatchObject({
      iconClassName: 'i-ri-lock-line',
      label: 'app.accessControlDialog.accessItems.specific',
    })

    act(() => {
      result.current.handleClickAccessControl()
    })
    expect(result.current.showAccessControl).toBe(true)

    await act(async () => {
      await result.current.handleAccessControlUpdate()
    })

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetAppDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'app-2' }))
    })
    expect(result.current.showAccessControl).toBe(false)
  })
})
