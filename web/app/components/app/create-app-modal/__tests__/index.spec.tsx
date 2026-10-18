import type { AppDetail } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { HotkeyManager } from '@tanstack/react-hotkeys'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useRouter } from '@/next/navigation'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import CreateAppModal from '../index'

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'] as string[],
}))
const mockCreateApp = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useParams: () => ({}),
}))
vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: vi.fn(),
}))
let appQuota = { size: 0, limit: 1 }

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { zGetFeaturesResponse } = await import('@dify/contracts/api/console/features/zod.gen')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': async () => zGetFeaturesResponse.parse({ apps: appQuota }),
      'apps.post': ({ body }: { body: Record<string, unknown> }) => mockCreateApp(body),
    }),
  }
})
const toastMocks = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))
vi.mock('@/app/notifications', () => ({
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

const mockUseRouter = vi.mocked(useRouter)
const mockPush = vi.fn()
const mockTrackCreateApp = vi.mocked(trackCreateApp)
const mockGetRedirection = vi.mocked(getRedirection)
const { mockToastError } = toastMocks

const renderModal = () => {
  const onClose = vi.fn()
  const onCreateFromTemplate = vi.fn()
  render(
    <CreateAppModal
      show
      onClose={onClose}
      onCreateFromTemplate={onCreateFromTemplate}
      defaultAppMode={'advanced-chat'}
    />,
  )
  return { onClose, onCreateFromTemplate }
}

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { apps: appQuota },
    accountProfile: { id: 'user-1' },
  })
}

describe('CreateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    HotkeyManager.resetInstance()
    mockUseRouter.mockReturnValue({ push: mockPush } as unknown as ReturnType<typeof useRouter>)
    appQuota = { size: 0, limit: 1 }
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
  })

  it('creates an app and fires callbacks', async () => {
    const user = userEvent.setup()
    const mockApp = createAppDetailFixture({
      mode: 'advanced-chat' as const,
      maintainer: 'user-1',
    })
    mockCreateApp.mockResolvedValue(mockApp)
    const { onClose } = renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    await user.type(nameInput, 'My App')
    await user.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() =>
      expect(mockCreateApp).toHaveBeenCalledWith({
        name: 'My App',
        description: '',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#FFEAD5',
        mode: 'advanced-chat' as const,
      }),
    )

    expect(mockTrackCreateApp).toHaveBeenCalledWith({
      source: 'studio_blank',
      appMode: 'advanced-chat' as const,
    })
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

  it('waits for create_app tracking before redirecting after blank app creation', async () => {
    const user = userEvent.setup()
    const mockApp = createAppDetailFixture({
      mode: 'advanced-chat' as const,
      maintainer: 'user-1',
    })
    let resolveTracking: (() => void) | undefined
    mockCreateApp.mockResolvedValue(mockApp)
    mockTrackCreateApp.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveTracking = resolve
      }),
    )
    renderModal()

    await user.type(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), 'Tracked App')
    await user.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => {
      expect(mockTrackCreateApp).toHaveBeenCalledWith({
        source: 'studio_blank',
        appMode: 'advanced-chat' as const,
      })
    })
    const createButton = screen.getByRole('button', { name: /app\.newApp\.Create/ })
    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(createButton)

    expect(mockCreateApp).toHaveBeenCalledTimes(1)
    expect(mockGetRedirection).not.toHaveBeenCalled()

    resolveTracking?.()

    await waitFor(() => {
      expect(mockGetRedirection).toHaveBeenCalledWith(mockApp, mockPush, expect.any(Object))
    })
  })

  it('shows error toast when creation fails', async () => {
    const user = userEvent.setup()
    mockCreateApp.mockRejectedValue(new Error('boom'))
    const { onClose } = renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    await user.type(nameInput, 'My App')
    await user.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

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

  it('forwards the create-from-template entry action', async () => {
    const user = userEvent.setup()
    const { onCreateFromTemplate } = renderModal()

    await user.click(screen.getByText('app.newApp.noIdeaTip'))

    expect(onCreateFromTemplate).toHaveBeenCalled()
  })

  it.each([
    { platform: 'Win32', modifier: { ctrlKey: true } },
    { platform: 'MacIntel', modifier: { metaKey: true } },
  ])(
    'creates a beginner chat app from its scoped $platform shortcut and selected icon style',
    async ({ platform, modifier }) => {
      const user = userEvent.setup()
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
      mockCreateApp.mockResolvedValue(
        createAppDetailFixture({ id: 'chat-app', mode: 'chat' as const }),
      )
      renderModal()

      await user.click(screen.getByText('app.newApp.forBeginners'))
      await user.click(screen.getByText('app.types.chatbot'))
      await user.type(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), 'Keyboard App')
      await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
      })
      const pickerSearch = screen.getByPlaceholderText('app.iconPicker.search')
      fireEvent.keyDown(pickerSearch, { key: 'Enter', code: 'Enter', ...modifier })
      fireEvent.keyUp(pickerSearch, { key: 'Enter', code: 'Enter', ...modifier })
      expect(mockCreateApp).not.toHaveBeenCalled()
      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
      await user.type(
        screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder'),
        'Created from shortcut',
      )

      const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
      fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter', ...modifier })
      fireEvent.keyUp(nameInput, { key: 'Enter', code: 'Enter', ...modifier })

      await waitFor(() => {
        expect(mockCreateApp).toHaveBeenCalledWith({
          name: 'Keyboard App',
          description: 'Created from shortcut',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#F3FEE7',
          mode: 'chat' as const,
        })
      })
    },
  )

  it.each([
    { platform: 'Win32', modifier: { ctrlKey: true } },
    { platform: 'MacIntel', modifier: { metaKey: true } },
  ])(
    're-registers the $platform shortcut after the outer dialog remounts its content',
    async ({ platform, modifier }) => {
      const user = userEvent.setup()
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
      mockCreateApp.mockResolvedValue(
        createAppDetailFixture({ id: 'reopened-app', mode: 'advanced-chat' as const }),
      )
      const onClose = vi.fn()
      const modal = (show: boolean) => (
        <CreateAppModal
          show={show}
          onClose={onClose}
          onCreateFromTemplate={vi.fn()}
          defaultAppMode={'advanced-chat'}
        />
      )
      const { rerender } = render(modal(true))
      await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
      const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
      rerender(modal(false))
      await waitFor(() => expect(picker).not.toBeInTheDocument())
      rerender(modal(true))
      const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
      await user.type(nameInput, 'Reopened App')
      fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter', ...modifier })
      fireEvent.keyUp(nameInput, { key: 'Enter', code: 'Enter', ...modifier })
      await waitFor(() => expect(mockCreateApp).toHaveBeenCalledOnce())
      expect(mockCreateApp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reopened App' }))
      expect(onClose).toHaveBeenCalledOnce()
    },
  )

  it('keeps creation unavailable from both the button and shortcut without a name', () => {
    renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter', ctrlKey: true })
    fireEvent.keyUp(nameInput, { key: 'Enter', code: 'Enter', ctrlKey: true })

    expect(screen.getByRole('button', { name: /app\.newApp\.Create/ })).toBeDisabled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockCreateApp).not.toHaveBeenCalled()
  })

  it('ignores the keyboard shortcut when the app quota is exhausted and closes the icon picker', async () => {
    const user = userEvent.setup()
    appQuota = { size: 1, limit: 1 }

    renderModal()

    await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
    })

    expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter', ctrlKey: true })
    fireEvent.keyUp(nameInput, { key: 'Enter', code: 'Enter', ctrlKey: true })

    expect(mockCreateApp).not.toHaveBeenCalled()
  })

  it('should switch between app types before creating a completion app', async () => {
    const user = userEvent.setup()
    mockCreateApp.mockResolvedValue(
      createAppDetailFixture({ id: 'completion-app', mode: 'completion' as const }),
    )
    renderModal()

    await user.click(screen.getByText('app.types.workflow'))
    await user.click(screen.getByText('app.types.advanced'))
    await user.click(screen.getByText('app.newApp.forBeginners'))
    await user.click(screen.getByText('app.types.agent'))
    await user.click(screen.getByText('app.newApp.completeApp'))
    await user.type(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), 'Completion App')

    await user.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => {
      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Completion App',
          mode: 'completion' as const,
        }),
      )
    })
  })

  it('should ignore duplicate create clicks while a request is in flight', async () => {
    const user = userEvent.setup()
    let resolveCreate: ((value: AppDetail) => void) | undefined
    mockCreateApp.mockImplementation(
      () =>
        new Promise<AppDetail>((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderModal()

    await user.type(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), 'Slow App')

    const createButton = screen.getByRole('button', { name: /app\.newApp\.Create/ })
    await user.click(createButton)
    await waitFor(() => {
      expect(mockCreateApp).toHaveBeenCalledTimes(1)
    })

    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(createButton)

    expect(mockCreateApp).toHaveBeenCalledTimes(1)

    resolveCreate?.(createAppDetailFixture({ id: 'slow-app', mode: 'advanced-chat' as const }))
    await waitFor(() => {
      expect(mockGetRedirection).toHaveBeenCalledTimes(1)
    })
  })
})

mockEmojiData()
