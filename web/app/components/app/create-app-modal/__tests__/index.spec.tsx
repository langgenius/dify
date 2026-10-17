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
const mockConsoleStateReader = vi.hoisted(() => vi.fn())
const mockCreateApp = vi.hoisted(() => vi.fn())

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
      files: actual.consoleQuery.files,
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
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

const mockUseRouter = vi.mocked(useRouter)
const mockPush = vi.fn()
const mockTrackCreateApp = vi.mocked(trackCreateApp)
const mockGetRedirection = vi.mocked(getRedirection)
const { mockToastError } = toastMocks

let appQuota = { size: 0, limit: 1 }

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
  })
}

describe('CreateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    HotkeyManager.resetInstance()
    mockUseRouter.mockReturnValue({ push: mockPush } as unknown as ReturnType<typeof useRouter>)
    appQuota = { size: 0, limit: 1 }
    mockConsoleStateReader.mockReturnValue({
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: ['app.create_and_management'],
    })
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
  })

  it('names the app input separately from its group and focuses the description from its visible label', async () => {
    const user = userEvent.setup()
    renderModal()

    expect(screen.getByRole('group', { name: 'app.newApp.captionName' })).toContainElement(
      screen.getByRole('textbox', { name: 'app.newApp.name' }),
    )
    const description = screen.getByRole('textbox', { name: 'app.newApp.captionDescription' })
    await user.click(screen.getByText('app.newApp.captionDescription'))
    expect(description).toHaveFocus()
  })

  it('creates an app and fires callbacks', async () => {
    const mockApp = createAppDetailFixture({
      mode: 'advanced-chat' as const,
      maintainer: 'user-1',
    })
    mockCreateApp.mockResolvedValue(mockApp)
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

    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Tracked App' },
    })
    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => {
      expect(mockTrackCreateApp).toHaveBeenCalledWith({
        source: 'studio_blank',
        appMode: 'advanced-chat' as const,
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

  it.each([
    { platform: 'Win32', modifier: { ctrlKey: true } },
    { platform: 'MacIntel', modifier: { metaKey: true } },
  ])(
    'creates a beginner chat app from its scoped $platform shortcut and selected icon style',
    async ({ platform, modifier }) => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
      mockCreateApp.mockResolvedValue(
        createAppDetailFixture({ id: 'chat-app', mode: 'chat' as const }),
      )
      renderModal()

      fireEvent.click(screen.getByText('app.newApp.forBeginners'))
      fireEvent.click(screen.getByText('app.types.chatbot'))
      fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
        target: { value: 'Keyboard App' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
      })
      const pickerSearch = screen.getByPlaceholderText('app.iconPicker.search')
      fireEvent.keyDown(pickerSearch, { key: 'Enter', code: 'Enter', ...modifier })
      fireEvent.keyUp(pickerSearch, { key: 'Enter', code: 'Enter', ...modifier })
      expect(mockCreateApp).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
      fireEvent.change(screen.getByPlaceholderText('app.newApp.appDescriptionPlaceholder'), {
        target: { value: 'Created from shortcut' },
      })

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
      await userEvent.setup().click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
      const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
      rerender(modal(false))
      await waitFor(() => expect(picker).not.toBeInTheDocument())
      rerender(modal(true))
      const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'Reopened App' } })
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
    appQuota = { size: 1, limit: 1 }

    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
    await userEvent.setup().keyboard('{Escape}')
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
    mockCreateApp.mockResolvedValue(
      createAppDetailFixture({ id: 'completion-app', mode: 'completion' as const }),
    )
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
          mode: 'completion' as const,
        }),
      )
    })
  })

  it('should ignore duplicate create clicks while a request is in flight', async () => {
    let resolveCreate: ((value: AppDetail) => void) | undefined
    mockCreateApp.mockImplementation(
      () =>
        new Promise<AppDetail>((resolve) => {
          resolveCreate = resolve
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

    resolveCreate?.(createAppDetailFixture({ id: 'slow-app', mode: 'advanced-chat' as const }))
    await waitFor(() => {
      expect(mockGetRedirection).toHaveBeenCalledTimes(1)
    })
  })
})

mockEmojiData()
