import { act, waitFor } from '@testing-library/react'
import { renderHookWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { AppSourceType } from '@/service/share'
import { useTextGenerationAppState } from '../use-text-generation-app-state'

const renderHook = <Result, Props = void>(callback: (props: Props) => Result) =>
  renderHookWithSystemFeatures(callback, {
    systemFeatures: { branding: { enabled: false, workspace_logo: '' } },
  })

const {
  changeLanguageMock,
  fetchSavedMessageMock,
  getRawInputsFromUrlParamsMock,
  notifyMock,
  removeMessageMock,
  saveMessageMock,
  useAppFaviconMock,
  useDocumentTitleMock,
} = vi.hoisted(() => ({
  changeLanguageMock: vi.fn(() => Promise.resolve()),
  fetchSavedMessageMock: vi.fn(),
  getRawInputsFromUrlParamsMock: vi.fn(),
  notifyMock: vi.fn(),
  removeMessageMock: vi.fn(),
  saveMessageMock: vi.fn(),
  useAppFaviconMock: vi.fn(),
  useDocumentTitleMock: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
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

vi.mock('@/app/components/base/chat/utils', () => ({
  getRawInputsFromUrlParams: getRawInputsFromUrlParamsMock,
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
  ] as Record<string, Record<string, unknown>>[],
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
    getRawInputsFromUrlParamsMock.mockResolvedValue({})
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

  it('should apply workflow launch inputs from the url to hidden prompt variables', async () => {
    mockWebAppState.appParams = {
      ...defaultAppParams,
      user_input_form: [
        {
          'text-input': {
            label: 'Visible',
            variable: 'visible',
            required: true,
            max_length: 48,
            default: 'Shown',
            hide: false,
          },
        },
        {
          'text-input': {
            label: 'Hidden Secret',
            variable: 'secret',
            required: true,
            max_length: 48,
            default: '',
            hide: true,
          },
        },
      ],
    }
    getRawInputsFromUrlParamsMock.mockResolvedValue({
      secret: 'prefilled-secret',
    })

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: true,
    }))

    await waitFor(() => {
      expect(result.current.promptConfig?.prompt_variables).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: 'visible',
          default: 'Shown',
        }),
        expect.objectContaining({
          key: 'secret',
          hide: true,
          default: 'prefilled-secret',
        }),
      ]))
    })

    expect(getRawInputsFromUrlParamsMock).toHaveBeenCalled()
    expect(fetchSavedMessageMock).not.toHaveBeenCalled()
  })

  it('should coerce checkbox url defaults from string and boolean values', async () => {
    mockWebAppState.appParams = {
      ...defaultAppParams,
      user_input_form: [
        {
          checkbox: {
            label: 'Bool True',
            variable: 'bool_true',
            required: false,
            default: false,
            hide: true,
          },
        },
        {
          checkbox: {
            label: 'String True',
            variable: 'str_true',
            required: false,
            default: false,
            hide: true,
          },
        },
        {
          checkbox: {
            label: 'String False',
            variable: 'str_false',
            required: false,
            default: true,
            hide: true,
          },
        },
        {
          checkbox: {
            label: 'Invalid',
            variable: 'invalid_cb',
            required: false,
            default: false,
            hide: true,
          },
        },
      ],
    }
    getRawInputsFromUrlParamsMock.mockResolvedValue({
      bool_true: true,
      str_true: 'true',
      str_false: 'false',
      invalid_cb: 'invalid',
    })

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: true,
    }))

    await waitFor(() => {
      expect(result.current.promptConfig?.prompt_variables).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'bool_true', default: true }),
        expect.objectContaining({ key: 'str_true', default: true }),
        expect.objectContaining({ key: 'str_false', default: false }),
        expect.objectContaining({ key: 'invalid_cb', default: false }),
      ]))
    })
  })

  it('should coerce number url defaults and ignore NaN values', async () => {
    mockWebAppState.appParams = {
      ...defaultAppParams,
      user_input_form: [
        {
          number: {
            label: 'Valid Number',
            variable: 'num_valid',
            required: false,
            default: 0,
            hide: true,
          },
        },
        {
          number: {
            label: 'NaN Number',
            variable: 'num_nan',
            required: false,
            default: 0,
            hide: true,
          },
        },
      ],
    }
    getRawInputsFromUrlParamsMock.mockResolvedValue({
      num_valid: '42',
      num_nan: 'not-a-number',
    })

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: true,
    }))

    await waitFor(() => {
      expect(result.current.promptConfig?.prompt_variables).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'num_valid', default: 42 }),
        expect.objectContaining({ key: 'num_nan', default: 0 }),
      ]))
    })
  })

  it('should coerce select url defaults and ignore invalid options', async () => {
    mockWebAppState.appParams = {
      ...defaultAppParams,
      user_input_form: [
        {
          select: {
            label: 'Valid Option',
            variable: 'sel_valid',
            required: false,
            default: '',
            options: ['alpha', 'beta'],
            hide: true,
          },
        },
        {
          select: {
            label: 'Invalid Option',
            variable: 'sel_invalid',
            required: false,
            default: 'alpha',
            options: ['alpha', 'beta'],
            hide: true,
          },
        },
      ],
    }
    getRawInputsFromUrlParamsMock.mockResolvedValue({
      sel_valid: 'beta',
      sel_invalid: 'gamma',
    })

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: true,
    }))

    await waitFor(() => {
      expect(result.current.promptConfig?.prompt_variables).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'sel_valid', default: 'beta' }),
        expect.objectContaining({ key: 'sel_invalid', default: 'alpha' }),
      ]))
    })
  })

  it('should ignore non-string url values for text inputs', async () => {
    mockWebAppState.appParams = {
      ...defaultAppParams,
      user_input_form: [
        {
          'text-input': {
            label: 'Text Field',
            variable: 'text_field',
            required: false,
            max_length: 48,
            default: 'original',
            hide: true,
          },
        },
      ],
    }
    getRawInputsFromUrlParamsMock.mockResolvedValue({
      text_field: 12345,
    })

    const { result } = renderHook(() => useTextGenerationAppState({
      isInstalledApp: false,
      isWorkflow: true,
    }))

    await waitFor(() => {
      expect(result.current.promptConfig?.prompt_variables).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'text_field', default: 'original' }),
      ]))
    })
  })
})
