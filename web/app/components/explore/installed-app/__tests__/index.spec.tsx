import type {
  AppMode,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import WebAppStoreProvider, { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import InstalledApp from '../index'

const mocks = vi.hoisted(() => ({
  getAccessMode: vi.fn(),
  getInstalledApp: vi.fn(),
  getInstalledAppMeta: vi.fn(),
  getInstalledAppParameters: vi.fn(),
  getUserAccess: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const installedId = (input: { params: { installed_app_id: string } }) =>
    input.params.installed_app_id
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'enterprise.webAppAuth.isUserAllowedToAccessWebApp': (input: { query: { appId: string } }) =>
        mocks.getUserAccess(input.query.appId),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'enterprise.webAppAuth.getWebAppAccessMode': (input: { query: { appId: string } }) =>
        mocks.getAccessMode(input.query.appId),
      'installedApps.byInstalledAppId.get': (input) => mocks.getInstalledApp(installedId(input)),
      'installedApps.byInstalledAppId.meta.get': (input) =>
        mocks.getInstalledAppMeta(installedId(input)),
      'installedApps.byInstalledAppId.parameters.get': (input) =>
        mocks.getInstalledAppParameters(installedId(input)),
    }),
  }
})

// These independently tested surfaces are intentionally outside the route/store contract here.
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

const appParamsResponse = {
  annotation_reply: {},
  file_upload: { image: { enabled: false, number_limits: 0, transfer_methods: [] } },
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
}

const installedAppView = (id: string) => (
  <WebAppStoreProvider>
    <InstalledApp id={id} />
  </WebAppStoreProvider>
)

const renderInstalledApp = (
  id = 'installed-app-123',
  options: Parameters<typeof renderWithConsoleQuery>[1] = {},
) => renderWithConsoleQuery(installedAppView(id), options)

describe('InstalledApp', () => {
  beforeEach(() => {
    mocks.getAccessMode.mockResolvedValue({ accessMode: AccessMode.PUBLIC })
    mocks.getInstalledApp.mockResolvedValue(createInstalledApp())
    mocks.getInstalledAppMeta.mockResolvedValue({ tool_icons: {} })
    mocks.getInstalledAppParameters.mockResolvedValue(appParamsResponse)
    mocks.getUserAccess.mockResolvedValue({ result: true })
  })

  it.each<AppMode>(['chat', 'advanced-chat', 'agent-chat'] as const)(
    'renders chat for the supported %s mode',
    async (mode) => {
      mocks.getInstalledApp.mockResolvedValue(createInstalledApp(mode))
      renderInstalledApp()
      expect(await screen.findByText('Chat App')).toBeInTheDocument()
    },
  )

  it('renders completion and workflow surfaces explicitly', async () => {
    mocks.getInstalledApp.mockResolvedValue(createInstalledApp('completion'))
    const { rerender } = renderInstalledApp()
    expect(await screen.findByText('Completion App')).toBeInTheDocument()

    mocks.getInstalledApp.mockResolvedValue(createInstalledApp('workflow'))
    rerender(installedAppView('installed-app-456'))
    expect(await screen.findByText('Workflow App')).toBeInTheDocument()
  })

  it.each<AppMode>(['agent', 'channel', 'rag-pipeline'])(
    'fails closed for unsupported %s mode',
    async (mode) => {
      mocks.getInstalledApp.mockResolvedValue(createInstalledApp(mode))
      renderInstalledApp()
      expect(await screen.findByText('Unsupported installed app mode.')).toBeInTheDocument()
      expect(screen.queryByText('Chat App')).not.toBeInTheDocument()
    },
  )

  it('starts route-owned parameter, metadata, and access queries without waiting for detail', async () => {
    mocks.getInstalledApp.mockReturnValue(new Promise(() => {}))
    renderInstalledApp('installed-app-123', {
      systemFeatures: { webapp_auth: { enabled: true } },
    })

    await waitFor(() => {
      expect(mocks.getAccessMode).toHaveBeenCalledWith('installed-app-123')
      expect(mocks.getInstalledAppParameters).toHaveBeenCalledWith('installed-app-123')
      expect(mocks.getInstalledAppMeta).toHaveBeenCalledWith('installed-app-123')
    })
  })

  it('writes one contract-derived app snapshot into the installed-app runtime store', async () => {
    renderInstalledApp()

    await waitFor(() =>
      expect(useWebAppStore.getState().appInfo).toEqual({
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

  it('does not mount the app surface before the real access query settles', async () => {
    mocks.getUserAccess.mockReturnValue(new Promise(() => {}))
    renderInstalledApp('installed-app-123', {
      systemFeatures: { webapp_auth: { enabled: true } },
    })

    await waitFor(() => expect(mocks.getUserAccess).toHaveBeenCalledWith('app-123'))
    expect(screen.queryByText('Chat App')).not.toBeInTheDocument()
  })

  it('distinguishes a missing installed app from a recoverable detail failure', async () => {
    mocks.getInstalledApp.mockRejectedValue(createHttpError(new Response(null, { status: 404 })))
    const { unmount } = renderInstalledApp('missing-app')
    expect(await screen.findByText(/404/)).toBeInTheDocument()
    unmount()

    mocks.getInstalledApp.mockRejectedValue(new Error('Network unavailable'))
    renderInstalledApp('offline-app', {
      queryClient: new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }),
    })
    expect(await screen.findByText('Network unavailable')).toBeInTheDocument()
  })
})
