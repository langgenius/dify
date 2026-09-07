import type {
  AppMode,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { Mock } from 'vite-plus/test'
import { screen, waitFor } from '@testing-library/react'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InstalledApp from '../index'

const mocks = vi.hoisted(() => ({
  getAccessMode: vi.fn(),
  getInstalledApp: vi.fn(),
  getInstalledAppMeta: vi.fn(),
  getInstalledAppParameters: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['system-features'],
        queryOptions: () => ({
          queryKey: ['system-features'],
          queryFn: async () => ({ webapp_auth: { enabled: true } }),
        }),
      },
    },
    enterprise: {
      webAppAuth: {
        getWebAppAccessMode: {
          queryOptions: ({ input }: { input: { query: { appId: string } } }) => ({
            queryKey: ['installed-app-access-mode', input.query.appId],
            queryFn: () => mocks.getAccessMode(input.query.appId),
          }),
        },
      },
    },
    installedApps: {
      byInstalledAppId: {
        get: {
          queryOptions: ({ input }: { input: { params: { installed_app_id: string } } }) => ({
            queryKey: ['installed-app', input.params.installed_app_id],
            queryFn: () => mocks.getInstalledApp(input.params.installed_app_id),
            retry: false,
          }),
        },
        meta: {
          get: {
            queryOptions: ({ input }: { input: { params: { installed_app_id: string } } }) => ({
              queryKey: ['installed-app-meta', input.params.installed_app_id],
              queryFn: () => mocks.getInstalledAppMeta(input.params.installed_app_id),
            }),
          },
        },
        parameters: {
          get: {
            queryOptions: ({ input }: { input: { params: { installed_app_id: string } } }) => ({
              queryKey: ['installed-app-parameters', input.params.installed_app_id],
              queryFn: () => mocks.getInstalledAppParameters(input.params.installed_app_id),
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: vi.fn(),
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useGetUserCanAccessApp: vi.fn(),
}))

vi.mock('@/app/components/share/text-generation', () => ({
  default: ({ isWorkflow }: { isWorkflow?: boolean }) => (
    <div>{isWorkflow ? 'Workflow App' : 'Completion App'}</div>
  ),
}))

vi.mock('@/app/components/base/chat/chat-with-history', () => ({
  default: () => <div>Chat App</div>,
}))

const createInstalledApp = (mode: AppMode = 'chat'): InstalledAppResponse => ({
  id: 'installed-app-123',
  app_owner_tenant_id: 'tenant-1',
  editable: true,
  is_pinned: false,
  last_used_at: null,
  uninstallable: true,
  app: {
    id: 'app-123',
    name: 'Test App',
    description: 'Test description',
    mode,
    icon_type: 'emoji',
    icon: '🚀',
    icon_background: '#FFFFFF',
    icon_url: null,
    use_icon_as_answer_icon: false,
  },
})

describe('InstalledApp', () => {
  const updateAppInfo = vi.fn()
  const updateWebAppAccessMode = vi.fn()
  const updateAppParams = vi.fn()
  const updateWebAppMeta = vi.fn()
  const updateUserCanAccessApp = vi.fn()
  const appParams = {
    user_input_form: [],
    file_upload: { image: { enabled: false, number_limits: 0, transfer_methods: [] } },
    system_parameters: {},
  }
  const appMeta = { tool_icons: {} }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAccessMode.mockResolvedValue({ accessMode: AccessMode.PUBLIC })
    mocks.getInstalledApp.mockResolvedValue(createInstalledApp())
    mocks.getInstalledAppMeta.mockResolvedValue(appMeta)
    mocks.getInstalledAppParameters.mockResolvedValue({
      annotation_reply: {},
      file_upload: appParams.file_upload,
      more_like_this: {},
      opening_statement: null,
      retriever_resource: {},
      sensitive_word_avoidance: {},
      speech_to_text: {},
      suggested_questions: [],
      suggested_questions_after_answer: {},
      system_parameters: {
        audio_file_size_limit: 10,
        file_size_limit: 15,
        image_file_size_limit: 10,
        video_file_size_limit: 100,
        workflow_file_upload_limit: 10,
      },
      text_to_speech: {},
      user_input_form: [],
    })

    ;(useWebAppStore as unknown as Mock).mockImplementation(
      (
        selector: (state: {
          updateAppInfo: Mock
          updateWebAppAccessMode: Mock
          updateAppParams: Mock
          updateWebAppMeta: Mock
          updateUserCanAccessApp: Mock
        }) => unknown,
      ) =>
        selector({
          updateAppInfo,
          updateWebAppAccessMode,
          updateAppParams,
          updateWebAppMeta,
          updateUserCanAccessApp,
        }),
    )
    ;(useGetUserCanAccessApp as Mock).mockReturnValue({
      data: { result: true },
      error: null,
      isPending: false,
    })
  })

  it.each<AppMode>(['chat', 'advanced-chat', 'agent-chat'])(
    'renders chat for the supported %s mode',
    async (mode) => {
      mocks.getInstalledApp.mockResolvedValue(createInstalledApp(mode))

      renderWithConsoleQuery(<InstalledApp id="installed-app-123" />)

      expect(await screen.findByText('Chat App')).toBeInTheDocument()
    },
  )

  it('renders completion and workflow surfaces explicitly', async () => {
    mocks.getInstalledApp.mockResolvedValue(createInstalledApp('completion'))
    const { rerender } = renderWithConsoleQuery(<InstalledApp id="installed-app-123" />)
    expect(await screen.findByText('Completion App')).toBeInTheDocument()

    mocks.getInstalledApp.mockResolvedValue(createInstalledApp('workflow'))
    rerender(<InstalledApp id="installed-app-456" />)
    expect(await screen.findByText('Workflow App')).toBeInTheDocument()
  })

  it.each<AppMode>(['agent', 'channel', 'rag-pipeline'])(
    'fails closed for unsupported %s mode',
    async (mode) => {
      mocks.getInstalledApp.mockResolvedValue(createInstalledApp(mode))

      renderWithConsoleQuery(<InstalledApp id="installed-app-123" />)

      expect(await screen.findByText('Unsupported installed app mode.')).toBeInTheDocument()
      expect(screen.queryByText('Chat App')).not.toBeInTheDocument()
    },
  )

  it('starts route-owned parameter, metadata, and access queries without waiting for detail', async () => {
    mocks.getInstalledApp.mockReturnValue(new Promise(() => {}))

    renderWithConsoleQuery(<InstalledApp id="installed-app-123" />, {
      systemFeatures: { webapp_auth: { enabled: true } },
    })

    await waitFor(() => {
      expect(mocks.getAccessMode).toHaveBeenCalledWith('installed-app-123')
      expect(mocks.getInstalledAppParameters).toHaveBeenCalledWith('installed-app-123')
      expect(mocks.getInstalledAppMeta).toHaveBeenCalledWith('installed-app-123')
    })
  })

  it('writes one contract-derived app snapshot into the installed-app runtime store', async () => {
    renderWithConsoleQuery(<InstalledApp id="installed-app-123" />)

    await waitFor(() =>
      expect(updateAppInfo).toHaveBeenCalledWith({
        app_id: 'installed-app-123',
        custom_config: null,
        site: {
          title: 'Test App',
          description: 'Test description',
          icon_type: 'emoji',
          icon: '🚀',
          icon_background: '#FFFFFF',
          icon_url: null,
          prompt_public: false,
          copyright: '',
          show_workflow_steps: true,
          use_icon_as_answer_icon: false,
        },
      }),
    )
  })

  it('does not mount the app surface before the access query settles', async () => {
    ;(useGetUserCanAccessApp as Mock).mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
    })

    renderWithConsoleQuery(<InstalledApp id="installed-app-123" />)

    await waitFor(() => expect(mocks.getInstalledApp).toHaveBeenCalled())
    expect(screen.queryByText('Chat App')).not.toBeInTheDocument()
  })

  it('distinguishes a missing installed app from a recoverable detail failure', async () => {
    mocks.getInstalledApp.mockRejectedValue(new Response(null, { status: 404 }))
    const { unmount } = renderWithConsoleQuery(<InstalledApp id="missing-app" />)
    expect(await screen.findByText(/404/)).toBeInTheDocument()
    unmount()

    mocks.getInstalledApp.mockRejectedValue(new Error('Network unavailable'))
    renderWithConsoleQuery(<InstalledApp id="offline-app" />)
    expect(await screen.findByText('Network unavailable')).toBeInTheDocument()
  })
})
