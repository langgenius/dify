import type { ReactElement } from 'react'
import type { App } from '@/types/app'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useRouter } from '@/next/navigation'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import CreateAppModal from '../index'

const ahooksMocks = vi.hoisted(() => ({
  keyPressHandlers: [] as Array<() => void>,
}))
const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'] as string[],
}))
const mockConsoleStateReader = vi.hoisted(() => vi.fn())
const mockCreateApp = vi.hoisted(() => vi.fn())

vi.mock('ahooks', () => ({
  useDebounceFn: <T extends (...args: unknown[]) => unknown>(fn: T) => {
    const run = (...args: Parameters<T>) => fn(...args)
    const cancel = vi.fn()
    const flush = vi.fn()
    return { run, cancel, flush }
  },
  useHover: () => false,
}))
vi.mock('@tanstack/react-hotkeys', () => ({
  formatForDisplay: (key: string) => key,
  useHotkey: (_hotkey: string, handler: () => void) => {
    ahooksMocks.keyPressHandlers.push(handler)
  },
}))
vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useParams: () => ({}),
}))
vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()

  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      features: actual.consoleQuery.features,
      account: {
        profile: {
          get: {
            queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
          },
        },
      },
      systemFeatures: actual.consoleQuery.systemFeatures,
      apps: {
        ...actual.consoleQuery.apps,
        post: {
          mutationOptions: () => ({
            mutationFn: ({ body }: { body: Record<string, unknown> }) => mockCreateApp(body),
          }),
        },
      },
    },
  }
})
const toastMocks = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: toastMocks.mockToastSuccess,
    error: toastMocks.mockToastError,
  },
}))
vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: () => <div>apps-full</div>,
}))
vi.mock('@/utils/app-redirection', () => ({
  getRedirection: vi.fn(),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => '/guides',
}))
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

const mockUseRouter = vi.mocked(useRouter)
const mockPush = vi.fn()
const mockTrackCreateApp = vi.mocked(trackCreateApp)
const mockGetRedirection = vi.mocked(getRedirection)
const { mockToastSuccess, mockToastError } = toastMocks

let appQuota = { size: 0, limit: 1 }
let appBuilderEnabled = false

const renderModal = () => {
  const onClose = vi.fn()
  const onCreateFromTemplate = vi.fn()
  render(
    <CreateAppModal
      show
      onClose={onClose}
      onCreateFromTemplate={onCreateFromTemplate}
      defaultAppMode={AppModeEnum.ADVANCED_CHAT}
    />,
  )
  return { onClose, onCreateFromTemplate }
}

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { apps: appQuota, dify_builder_enabled: appBuilderEnabled },
  })
}

describe('CreateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ahooksMocks.keyPressHandlers.length = 0
    mockUseRouter.mockReturnValue({ push: mockPush } as unknown as ReturnType<typeof useRouter>)
    appQuota = { size: 0, limit: 1 }
    appBuilderEnabled = false
    mockConsoleStateReader.mockReturnValue({
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: ['app.create_and_management'],
    })
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
  })

  it('creates an app, notifies success, and fires callbacks', async () => {
    const mockApp: Partial<App> = {
      id: 'app-1',
      mode: AppModeEnum.ADVANCED_CHAT,
      maintainer: 'user-1',
    }
    mockCreateApp.mockResolvedValue(mockApp as App)
    const { onClose } = renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() =>
      expect(mockCreateApp).toHaveBeenCalledWith({
        name: 'My App',
        description: '',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#FFEAD5',
        mode: AppModeEnum.ADVANCED_CHAT,
      }),
    )

    expect(mockTrackCreateApp).toHaveBeenCalledWith({
      source: 'studio_blank',
      appMode: AppModeEnum.ADVANCED_CHAT,
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('app.newApp.appCreated')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mockGetRedirection).toHaveBeenCalledWith(mockApp, mockPush, {
        currentUserId: 'user-1',
        resourceMaintainer: 'user-1',
        workspacePermissionKeys: ['app.create_and_management'],
        isRbacEnabled: false,
      }),
    )
  })

  it('defaults to App Builder and preserves both drafts and app types when switching creation methods', async () => {
    appBuilderEnabled = true
    const user = userEvent.setup()
    renderModal()

    expect(screen.getByRole('radio', { name: 'workflow.difyBuilder.panelTitle' })).toBeChecked()
    expect(
      screen.queryByRole('textbox', { name: 'app.newApp.captionName' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'app.newApp.forBeginners' }),
    ).not.toBeInTheDocument()
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build an expense workflow',
    )
    await user.click(screen.getByRole('button', { name: /app\.types\.workflow/ }))
    await user.click(screen.getByRole('radio', { name: 'app.newApp.blank' }))
    await user.type(screen.getByRole('textbox', { name: 'app.newApp.captionName' }), 'Manual app')
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.captionDescription' }),
      'Manual description',
    )
    await user.click(screen.getByRole('button', { name: 'app.newApp.forBeginners' }))
    await user.click(screen.getByRole('button', { name: /app\.types\.chatbot/ }))

    await user.click(screen.getByRole('radio', { name: 'workflow.difyBuilder.panelTitle' }))
    expect(screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' })).toHaveValue(
      'Build an expense workflow',
    )
    expect(screen.getByRole('button', { name: /app\.types\.workflow/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('radio', { name: 'app.newApp.blank' }))
    expect(screen.getByRole('textbox', { name: 'app.newApp.captionName' })).toHaveValue(
      'Manual app',
    )
    expect(screen.getByRole('textbox', { name: 'app.newApp.captionDescription' })).toHaveValue(
      'Manual description',
    )
    expect(screen.getByRole('button', { name: /app\.types\.chatbot/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it.each([AppModeEnum.ADVANCED_CHAT, AppModeEnum.WORKFLOW])(
    'creates a %s app with a default name and redirects from a Builder prompt',
    async (mode) => {
      appBuilderEnabled = true
      mockTrackCreateApp.mockReturnValue(undefined)
      const app = { id: 'builder-app', mode, maintainer: 'user-1' }
      mockCreateApp.mockResolvedValue(app)
      const user = userEvent.setup()
      const { onClose } = renderModal()
      if (mode === AppModeEnum.WORKFLOW)
        await user.click(screen.getByRole('button', { name: /app\.types\.workflow/ }))
      await user.type(
        screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
        '  Build an expense workflow  ',
      )
      await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

      await waitFor(() =>
        expect(mockCreateApp).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'app.newApp.defaultName', description: '', mode }),
        ),
      )
      await waitFor(() =>
        expect(mockGetRedirection).toHaveBeenCalledWith(
          app,
          mockPush,
          expect.objectContaining({ currentUserId: 'user-1' }),
        ),
      )
      expect(onClose).toHaveBeenCalledOnce()
    },
  )

  it('retains the Builder prompt after creation fails and allows retry', async () => {
    appBuilderEnabled = true
    mockTrackCreateApp.mockReturnValue(undefined)
    mockCreateApp
      .mockRejectedValueOnce(new Error('Creation failed'))
      .mockResolvedValueOnce({ id: 'retried-app', mode: AppModeEnum.ADVANCED_CHAT })
    const user = userEvent.setup()
    const { onClose } = renderModal()
    const input = screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' })
    const send = screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })
    await user.type(input, 'Build a support chatflow')
    await user.click(send)
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Creation failed'))
    expect(input).toHaveValue('Build a support chatflow')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(send)
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(mockCreateApp).toHaveBeenCalledTimes(2)
  })

  it('blocks empty Builder submissions, including the create shortcut', async () => {
    appBuilderEnabled = true
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }), '   ')
    expect(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })).toBeDisabled()
    ahooksMocks.keyPressHandlers.at(-1)?.()
    expect(mockCreateApp).not.toHaveBeenCalled()
  })

  it('applies app quota limits to Builder creation', async () => {
    appBuilderEnabled = true
    appQuota = { size: 1, limit: 1 }
    const user = userEvent.setup()
    renderModal()
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build a support chatflow',
    )
    expect(screen.getByText('apps-full')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })).toBeDisabled()
    ahooksMocks.keyPressHandlers.at(-1)?.()
    expect(mockCreateApp).not.toHaveBeenCalled()
  })

  it('waits for create_app tracking before redirecting after blank app creation', async () => {
    const mockApp: Partial<App> = {
      id: 'app-1',
      mode: AppModeEnum.ADVANCED_CHAT,
      maintainer: 'user-1',
    }
    let resolveTracking: (() => void) | undefined
    mockCreateApp.mockResolvedValue(mockApp as App)
    mockTrackCreateApp.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveTracking = resolve
      }),
    )
    renderModal()

    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Tracked App' },
    })
    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => {
      expect(mockTrackCreateApp).toHaveBeenCalledWith({
        source: 'studio_blank',
        appMode: AppModeEnum.ADVANCED_CHAT,
      })
    })
    const createButton = screen.getByRole('button', { name: /app\.newApp\.Create/ })
    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(createButton)

    expect(mockCreateApp).toHaveBeenCalledTimes(1)
    expect(mockGetRedirection).not.toHaveBeenCalled()

    resolveTracking?.()

    await waitFor(() => {
      expect(mockGetRedirection).toHaveBeenCalledWith(mockApp, mockPush, expect.any(Object))
    })
  })

  it('shows error toast when creation fails', async () => {
    mockCreateApp.mockRejectedValue(new Error('boom'))
    const { onClose } = renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => expect(mockCreateApp).toHaveBeenCalled())
    expect(mockToastError).toHaveBeenCalledWith('boom')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the apps-full notice and disables creation when the workspace quota is exhausted', () => {
    appQuota = { size: 1, limit: 1 }

    renderModal()

    expect(screen.getByText('apps-full')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /app\.newApp\.Create/ })).toBeDisabled()
  })

  it('forwards the create-from-template entry action', () => {
    const { onCreateFromTemplate } = renderModal()

    fireEvent.click(screen.getByText('app.newApp.noIdeaTip'))

    expect(onCreateFromTemplate).toHaveBeenCalled()
  })

  it('creates a beginner chat app with the keyboard shortcut and selected icon style', async () => {
    mockCreateApp.mockResolvedValue({ id: 'chat-app', mode: AppModeEnum.CHAT } as App)
    renderModal()

    fireEvent.click(screen.getByText('app.newApp.forBeginners'))
    fireEvent.click(screen.getByText('app.types.chatbot'))
    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.captionName' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '#E4FBCC' }))
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Keyboard App' },
    })
    fireEvent.change(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder'), {
      target: { value: 'Created from shortcut' },
    })

    ahooksMocks.keyPressHandlers.at(-1)?.()

    await waitFor(() => {
      expect(mockCreateApp).toHaveBeenCalledWith({
        name: 'Keyboard App',
        description: 'Created from shortcut',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#E4FBCC',
        mode: AppModeEnum.CHAT,
      })
    })
  })

  it('shows validation feedback when the keyboard shortcut runs without a name', () => {
    renderModal()

    ahooksMocks.keyPressHandlers.at(-1)?.()

    expect(mockToastError).toHaveBeenCalledWith('app.newApp.nameNotEmpty')
    expect(mockCreateApp).not.toHaveBeenCalled()
  })

  it('ignores the keyboard shortcut when the app quota is exhausted and closes the icon picker', async () => {
    appQuota = { size: 1, limit: 1 }

    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.captionName' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.cancel/ }))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })

    expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()

    ahooksMocks.keyPressHandlers.at(-1)?.()

    expect(mockCreateApp).not.toHaveBeenCalled()
  })

  it('should switch between app types before creating a completion app', async () => {
    mockCreateApp.mockResolvedValue({ id: 'completion-app', mode: AppModeEnum.COMPLETION } as App)
    renderModal()

    fireEvent.click(screen.getByText('app.types.workflow'))
    fireEvent.click(screen.getByText('app.types.advanced'))
    fireEvent.click(screen.getByText('app.newApp.forBeginners'))
    fireEvent.click(screen.getByText('app.types.agent'))
    fireEvent.click(screen.getByText('app.newApp.completeApp'))
    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Completion App' },
    })

    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => {
      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Completion App',
          mode: AppModeEnum.COMPLETION,
        }),
      )
    })
  })

  it('should ignore duplicate create clicks while a request is in flight', async () => {
    let resolveCreate: ((value: App) => void) | undefined
    mockCreateApp.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (value: App) => void
        }),
    )
    renderModal()

    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Slow App' },
    })

    const createButton = screen.getByRole('button', { name: /app\.newApp\.Create/ })
    fireEvent.click(createButton)
    await waitFor(() => {
      expect(mockCreateApp).toHaveBeenCalledTimes(1)
    })

    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(createButton)

    expect(mockCreateApp).toHaveBeenCalledTimes(1)

    resolveCreate?.({ id: 'slow-app', mode: AppModeEnum.ADVANCED_CHAT } as App)
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('app.newApp.appCreated')
    })
  })
})
