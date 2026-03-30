import type { AppPublisherProps } from '../index'
import type { AppDetailResponse } from '@/models/app'
import type { SystemFeatures } from '@/types/feature'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { WorkflowContext } from '@/app/components/workflow/context'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import { basePath } from '@/utils/var'
import { useAppPublisher } from '../use-app-publisher'

const mockTrackEvent = vi.fn()
const mockGetSocket = vi.fn()
const mockRefetch = vi.fn()
const mockFetchAppDetailDirect = vi.fn()
const mockFetchInstalledAppList = vi.fn()
const mockFetchPublishedWorkflow = vi.fn()
const mockOpenAsyncWindow = vi.fn()
const mockPublishToCreatorsPlatform = vi.fn()
const mockInvalidateAppWorkflow = vi.fn()
const mockSetAppDetail = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockUnsubscribe = vi.fn()
const mockWindowOpen = vi.fn()

let capturedShortcut: ((event: { preventDefault: () => void }) => void) | undefined
let capturedPublishUpdate: ((update: { data: { action?: string } }) => void) | undefined
let mockAppDetail: AppDetailResponse | undefined
let mockSystemFeatures: SystemFeatures
let mockAccessSubjects: { groups?: Array<{ id: string }>, members?: Array<{ id: string }> } | undefined
let mockUserCanAccessApp: { result?: boolean } | undefined
let mockGetUserCanAccessAppLoading = false
let mockAppWhiteListSubjectsLoading = false

vi.mock('ahooks', () => ({
  useKeyPress: (_key: string, callback: (event: { preventDefault: () => void }) => void) => {
    capturedShortcut = callback
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppPublishUpdate: (callback: (update: { data: { action?: string } }) => void) => {
      capturedPublishUpdate = callback
      return mockUnsubscribe
    },
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: (...args: unknown[]) => mockGetSocket(...args),
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail?: AppDetailResponse, setAppDetail: typeof mockSetAppDetail }) => unknown) => selector({
    appDetail: mockAppDetail,
    setAppDetail: mockSetAppDetail,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: SystemFeatures }) => unknown) => selector({
    systemFeatures: mockSystemFeatures,
  }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (time: number) => `from-now:${time}`,
  }),
}))

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: () => ({
    data: mockAccessSubjects,
    isLoading: mockAppWhiteListSubjectsLoading,
  }),
  useGetUserCanAccessApp: () => ({
    data: mockUserCanAccessApp,
    isLoading: mockGetUserCanAccessAppLoading,
    refetch: mockRefetch,
  }),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    apps: {
      publishToCreatorsPlatform: (...args: unknown[]) => mockPublishToCreatorsPlatform(...args),
    },
  },
}))

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: (...args: unknown[]) => mockFetchInstalledAppList(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAppWorkflow: () => mockInvalidateAppWorkflow,
}))

vi.mock('@/service/workflow', () => ({
  fetchPublishedWorkflow: (...args: unknown[]) => mockFetchPublishedWorkflow(...args),
}))

const createSystemFeatures = (overrides: Partial<SystemFeatures> = {}): SystemFeatures => ({
  ...defaultSystemFeatures,
  ...overrides,
  branding: {
    ...defaultSystemFeatures.branding,
    ...overrides.branding,
  },
  license: {
    ...defaultSystemFeatures.license,
    ...overrides.license,
  },
  plugin_installation_permission: {
    ...defaultSystemFeatures.plugin_installation_permission,
    ...overrides.plugin_installation_permission,
  },
  webapp_auth: {
    ...defaultSystemFeatures.webapp_auth,
    ...overrides.webapp_auth,
    sso_config: {
      ...defaultSystemFeatures.webapp_auth.sso_config,
      ...overrides.webapp_auth?.sso_config,
    },
  },
})

const createAppDetail = (overrides: Partial<AppDetailResponse> = {}): AppDetailResponse => ({
  access_mode: AccessMode.PUBLIC,
  description: 'Workflow description',
  icon: '🤖',
  icon_background: '#ffffff',
  icon_type: 'emoji',
  id: 'app-1',
  mode: AppModeEnum.WORKFLOW,
  name: 'Workflow app',
  site: {
    app_base_url: 'https://apps.example.com',
    access_token: 'app-token',
  },
  ...overrides,
} as AppDetailResponse)

const createProps = (overrides: Partial<AppPublisherProps> = {}): AppPublisherProps => ({
  crossAxisOffset: 12,
  debugWithMultipleModel: false,
  draftUpdatedAt: 5678,
  hasHumanInputNode: false,
  hasTriggerNode: false,
  inputs: [],
  missingStartNode: false,
  multipleModelConfigs: [],
  onPublish: vi.fn(),
  onRefreshData: vi.fn(),
  onRestore: vi.fn(),
  onToggle: vi.fn(),
  outputs: [],
  publishDisabled: false,
  publishedAt: 1234,
  publishLoading: false,
  startNodeLimitExceeded: false,
  toolPublished: false,
  workflowToolAvailable: true,
  ...overrides,
})

const createWrapper = () => {
  const store = {
    getState: () => ({
      setPublishedAt: mockSetPublishedAt,
    }),
  } as unknown as NonNullable<React.ContextType<typeof WorkflowContext>>

  return ({ children }: { children: React.ReactNode }) => (
    <WorkflowContext value={store}>
      {children}
    </WorkflowContext>
  )
}

describe('useAppPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedShortcut = undefined
    capturedPublishUpdate = undefined
    mockAppDetail = createAppDetail()
    mockSystemFeatures = createSystemFeatures()
    mockAccessSubjects = {
      groups: [{ id: 'group-1' }],
      members: [],
    }
    mockUserCanAccessApp = {
      result: true,
    }
    mockGetUserCanAccessAppLoading = false
    mockAppWhiteListSubjectsLoading = false
    mockGetSocket.mockReturnValue({
      emit: vi.fn(),
    })
    mockOpenAsyncWindow.mockImplementation(async (getUrl: () => Promise<string>, options?: { onError?: (error: Error) => void }) => {
      try {
        return await getUrl()
      }
      catch (error) {
        options?.onError?.(error as Error)
      }
    })
    mockPublishToCreatorsPlatform.mockResolvedValue({
      redirect_url: 'https://marketplace.example.com/app-1',
    })
    mockFetchInstalledAppList.mockResolvedValue({
      installed_apps: [{ id: 'installed-1' }],
    })
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail({ name: 'Updated app' }))
    mockFetchPublishedWorkflow.mockResolvedValue({
      created_at: 4321,
    })
    window.open = mockWindowOpen as typeof window.open
  })

  it('should expose derived app metadata and default action state', () => {
    const { result } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    expect(result.current.appURL).toBe(`https://apps.example.com${basePath}/workflow/app-token`)
    expect(result.current.isChatApp).toBe(false)
    expect(result.current.disabledFunctionButton).toBe(false)
    expect(result.current.disabledFunctionTooltip).toBeUndefined()
    expect(result.current.workflowToolDisabled).toBe(false)
    expect(result.current.workflowToolMessage).toBeUndefined()
    expect(result.current.formatTimeFromNow(1234)).toBe('from-now:1234')
  })

  it('should derive access warnings and refetch when the popover opens', async () => {
    mockSystemFeatures = createSystemFeatures({
      webapp_auth: {
        ...defaultSystemFeatures.webapp_auth,
        enabled: true,
      },
    })
    mockAppDetail = createAppDetail({
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    })
    mockAccessSubjects = {
      groups: [],
      members: [],
    }
    mockUserCanAccessApp = {
      result: false,
    }
    const onToggle = vi.fn()

    const { result } = renderHook(() => useAppPublisher(createProps({ onToggle })), {
      wrapper: createWrapper(),
    })

    expect(result.current.isAppAccessSet).toBe(false)
    expect(result.current.disabledFunctionButton).toBe(true)
    expect(result.current.disabledFunctionTooltip).toBe('app.noAccessPermission')

    act(() => {
      result.current.handleTrigger()
    })

    expect(result.current.open).toBe(true)
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('should publish through the keyboard shortcut and emit collaboration updates', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined)
    const emit = vi.fn()
    mockGetSocket.mockReturnValue({ emit })

    const { result } = renderHook(() => useAppPublisher(createProps({ onPublish })), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await capturedShortcut?.({ preventDefault: vi.fn() })
    })

    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(result.current.published).toBe(true)
    expect(mockInvalidateAppWorkflow).toHaveBeenCalledWith('app-1')
    expect(emit).toHaveBeenCalledWith('collaboration_event', expect.objectContaining({
      type: 'app_publish_update',
      data: expect.objectContaining({ action: 'published' }),
    }))
    expect(mockTrackEvent).toHaveBeenCalledWith('app_published_time', expect.objectContaining({
      app_id: 'app-1',
      app_name: 'Workflow app',
    }))
  })

  it('should keep the menu closed when restore finishes and swallow restore failures', async () => {
    const onRestore = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('restore failed'))
    const { result } = renderHook(() => useAppPublisher(createProps({ onRestore })), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleTrigger()
    })

    await act(async () => {
      await result.current.handleRestore()
    })

    expect(result.current.open).toBe(false)

    act(() => {
      result.current.handleTrigger()
    })

    await act(async () => {
      await result.current.handleRestore()
    })

    expect(result.current.open).toBe(true)
  })

  it('should open the embedding modal, refresh app access, and close both overlays', async () => {
    const { result } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleTrigger()
    })

    act(() => {
      result.current.handleOpenEmbedding()
    })

    expect(result.current.embeddingModalOpen).toBe(true)
    expect(result.current.open).toBe(false)

    act(() => {
      result.current.showAppAccessControlModal()
    })

    expect(result.current.showAppAccessControl).toBe(true)

    await act(async () => {
      await result.current.handleAccessControlUpdate()
    })

    expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
    expect(mockSetAppDetail).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated app' }))
    expect(result.current.showAppAccessControl).toBe(false)

    act(() => {
      result.current.closeEmbeddingModal()
      result.current.closeAppAccessControl()
    })

    expect(result.current.embeddingModalOpen).toBe(false)
    expect(result.current.showAppAccessControl).toBe(false)
  })

  it('should resolve the explore URL and surface window-open errors via toast', async () => {
    const { result } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleOpenInExplore()
    })

    expect(mockFetchInstalledAppList).toHaveBeenCalledWith('app-1')

    mockFetchInstalledAppList.mockResolvedValueOnce({ installed_apps: [] })

    await act(async () => {
      await result.current.handleOpenInExplore()
    })

    expect(toast.error).toHaveBeenCalledWith('No app found in Explore')
  })

  it('should publish to marketplace and reset loading after failures', async () => {
    const { result } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handlePublishToMarketplace()
    })

    expect(mockPublishToCreatorsPlatform).toHaveBeenCalledWith({
      params: { appId: 'app-1' },
    })
    expect(mockWindowOpen).toHaveBeenCalledWith('https://marketplace.example.com/app-1', '_blank')
    expect(result.current.publishingToMarketplace).toBe(false)

    mockPublishToCreatorsPlatform.mockRejectedValueOnce(new Error('publish failed'))

    await act(async () => {
      await result.current.handlePublishToMarketplace()
    })

    expect(toast.error).toHaveBeenCalledWith('publish failed')
    expect(result.current.publishingToMarketplace).toBe(false)
  })

  it('should ignore marketplace publishing when the app id is missing', async () => {
    mockAppDetail = createAppDetail({ id: '' })

    const { result } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handlePublishToMarketplace()
    })

    expect(mockPublishToCreatorsPlatform).not.toHaveBeenCalled()
  })

  it('should refresh published workflow timestamps from collaboration events and unsubscribe on unmount', async () => {
    const { unmount } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      capturedPublishUpdate?.({ data: { action: 'published' } })
    })

    await waitFor(() => {
      expect(mockFetchPublishedWorkflow).toHaveBeenCalledWith('/apps/app-1/workflows/publish')
    })

    expect(mockSetPublishedAt).toHaveBeenCalledWith(4321)

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('should warn when publish succeeds without an app id or socket', async () => {
    mockAppDetail = createAppDetail({ id: '' })
    mockGetSocket.mockReturnValue(null)
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useAppPublisher(createProps()), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handlePublish()
    })

    expect(mockInvalidateAppWorkflow).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith('[app-publisher] missing appId, skip workflow invalidate and socket emit')

    consoleWarnSpy.mockRestore()
  })
})
