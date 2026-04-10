import { act, renderHook, waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import { useTextGenerationAppState } from '../use-text-generation-app-state'

const {
  changeLanguageMock,
  fetchSavedMessageMock,
  notifyMock,
  removeMessageMock,
  saveMessageMock,
  useAppFaviconMock,
  useDocumentTitleMock,
} = vi.hoisted(() => ({
  changeLanguageMock: vi.fn(() => Promise.resolve()),
  fetchSavedMessageMock: vi.fn(),
  notifyMock: vi.fn(),
  removeMessageMock: vi.fn(),
  saveMessageMock: vi.fn(),
  useAppFaviconMock: vi.fn(),
  useDocumentTitleMock: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  default: {
    notify: notifyMock,
  },
  toast: {
    success: (message: string) => notifyMock({ type: 'success', message }),
    error: (message: string) => notifyMock({ type: 'error', message }),
    warning: (message: string) => notifyMock({ type: 'warning', message }),
    info: (message: string) => notifyMock({ type: 'info', message }),
  },
}))

vi.mock('@/hooks/use-app-favicon', () => ({
  useAppFavicon: useAppFaviconMock,
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: useDocumentTitleMock,
}))

vi.mock('@/i18n-config/client', () => ({
  changeLanguage: changeLanguageMock,
}))

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    fetchSavedMessage: (...args: Parameters<typeof actual.fetchSavedMessage>) => fetchSavedMessageMock(...args),
    removeMessage: (...args: Parameters<typeof actual.removeMessage>) => removeMessageMock(...args),
    saveMessage: (...args: Parameters<typeof actual.saveMessage>) => saveMessageMock(...args),
  }
})

const mockSystemFeatures = {
  branding: {
    enabled: false,
    workspace_logo: null,
  },
}

const defaultAppInfo = {
  app_id: 'app-123',
  site: {
    title: 'Share title',
    description: 'Share description',
    default_language: 'en-US',
    icon_type: 'emoji',
    icon: 'robot',
    icon_background: '#fff',
    icon_url: '',
  },
  custom_config: {
    remove_webapp_brand: false,
    replace_webapp_logo: '',
  },
}

type MockAppInfo = Omit<typeof defaultAppInfo, 'custom_config'> & {
  custom_config: typeof defaultAppInfo.custom_config | null
}

const defaultAppParams = {
  user_input_form: [
    {
      'text-input': {
        label: 'Name',
        variable: 'name',
        required: true,
        max_length: 48,
        default: 'Alice',
        hide: false,
      },
    },
    {
      checkbox: {
        label: 'Enabled',
        variable: 'enabled',
        required: false,
        default: true,
        hide: false,
      },
    },
  ],
  more_like_this: {
    enabled: true,
  },
  file_upload: {
    enabled: true,
    number_limits: 2,
    detail: 'low',
    allowed_upload_methods: ['local_file'],
  },
  text_to_speech: {
    enabled: true,
  },
  system_parameters: {
    image_file_size_limit: 10,
  },
}

type MockWebAppState = {
  appInfo: MockAppInfo | null
  appParams: typeof defaultAppParams | null
  webAppAccessMode: string
}

const mockWebAppState: MockWebAppState = {
  appInfo: defaultAppInfo,
  appParams: defaultAppParams,
  webAppAccessMode: 'public',
}

const resetMockWebAppState = () => {
  mockWebAppState.appInfo = {
    ...defaultAppInfo,
    site: {
      ...defaultAppInfo.site,
    },
    custom_config: {
      ...defaultAppInfo.custom_config,
    },
  }
  mockWebAppState.appParams = {
    ...defaultAppParams,
    user_input_form: [...defaultAppParams.user_input_form],
    more_like_this: {
      enabled: true,
    },
    file_upload: {
      ...defaultAppParams.file_upload,
      allowed_upload_methods: [...defaultAppParams.file_upload.allowed_upload_methods],
    },
    text_to_speech: {
      ...defaultAppParams.text_to_speech,
    },
    system_parameters: {
      image_file_size_limit: 10,
    },
  }
  mockWebAppState.webAppAccessMode = 'public'
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: typeof mockSystemFeatures }) => unknown) =>
    selector({ systemFeatures: mockSystemFeatures }),
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof mockWebAppState) => unknown) => selector(mockWebAppState),
}))

describe('useTextGenerationAppState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockWebAppState()
    fetchSavedMessageMock.mockResolvedValue({
      data: [{ id: 'saved-1' }],
    })
    removeMessageMock.mockResolvedValue(undefined)
    saveMessageMock.mockResolvedValue(undefined)
  })

  it('should initialize app state and fetch saved messages for non-workflow web apps', async () => {
    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: false,
    }))

    await waitFor(() => {
      expect(result.current.appId).toBe('app-123')
      expect(result.current.promptConfig?.prompt_variables.map(item => item.name)).toEqual(['Name', 'Enabled'])
      expect(result.current.savedMessages).toEqual([{ id: 'saved-1' }])
    })

    expect(result.current.appSourceType).toBe(AppSourceType.webApp)
    expect(result.current.siteInfo?.title).toBe('Share title')
    expect(result.current.visionConfig.transfer_methods).toEqual(['local_file'])
    expect(result.current.visionConfig.image_file_size_limit).toBe(10)
    expect(changeLanguageMock).toHaveBeenCalledWith('en-US')
    expect(fetchSavedMessageMock).toHaveBeenCalledWith(AppSourceType.webApp, 'app-123')
    expect(useDocumentTitleMock).toHaveBeenCalledWith('Share title')
    expect(useAppFaviconMock).toHaveBeenCalledWith(expect.objectContaining({
      enable: true,
      icon: 'robot',
    }))
  })

  it('should no-op save actions before the app id is initialized', async () => {
    mockWebAppState.appInfo = null
    mockWebAppState.appParams = null

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: false,
    }))

    await act(async () => {
      await result.current.fetchSavedMessages('')
      await result.current.handleSaveMessage('message-1')
      await result.current.handleRemoveSavedMessage('message-1')
    })

    expect(result.current.appId).toBe('')
    expect(fetchSavedMessageMock).not.toHaveBeenCalled()
    expect(saveMessageMock).not.toHaveBeenCalled()
    expect(removeMessageMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('should fallback to null custom config when the share metadata omits it', async () => {
    mockWebAppState.appInfo = {
      ...defaultAppInfo,
      custom_config: null,
    }

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: false,
    }))

    await waitFor(() => {
      expect(result.current.appId).toBe('app-123')
      expect(result.current.customConfig).toBeNull()
    })
  })

  it('should save and remove messages then refresh saved messages', async () => {
    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: false,
    }))

    await waitFor(() => {
      expect(result.current.appId).toBe('app-123')
    })

    fetchSavedMessageMock.mockClear()

    await act(async () => {
      await result.current.handleSaveMessage('message-1')
    })

    expect(saveMessageMock).toHaveBeenCalledWith('message-1', AppSourceType.webApp, 'app-123')
    expect(fetchSavedMessageMock).toHaveBeenCalledWith(AppSourceType.webApp, 'app-123')
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.saved',
    })

    fetchSavedMessageMock.mockClear()
    notifyMock.mockClear()

    await act(async () => {
      await result.current.handleRemoveSavedMessage('message-1')
    })

    expect(removeMessageMock).toHaveBeenCalledWith('message-1', AppSourceType.webApp, 'app-123')
    expect(fetchSavedMessageMock).toHaveBeenCalledWith(AppSourceType.webApp, 'app-123')
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.remove',
    })
  })

  it('should skip saved message fetching for workflows and disable favicon for installed apps', async () => {
    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: true,
      isWorkflow: true,
    }))

    await waitFor(() => {
      expect(result.current.appId).toBe('app-123')
    })

    expect(result.current.appSourceType).toBe(AppSourceType.installedApp)
    expect(fetchSavedMessageMock).not.toHaveBeenCalled()
    expect(useAppFaviconMock).toHaveBeenCalledWith(expect.objectContaining({
      enable: false,
    }))
  })
})
