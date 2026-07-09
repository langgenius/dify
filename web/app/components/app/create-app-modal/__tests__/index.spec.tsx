import type { App } from '@/types/app'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { NEED_REFRESH_APP_LIST_KEY } from '@/app/components/apps/storage'
import { useProviderContext } from '@/context/provider-context'
import { useRouter } from '@/next/navigation'
import { createApp } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import CreateAppModal from '../index'

const ahooksMocks = vi.hoisted(() => ({
  keyPressHandlers: [] as Array<() => void>,
}))
const mockInvalidateAppList = vi.hoisted(() => vi.fn())
const mockAppContextState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'] as string[],
}))
const mockUseAppContext = vi.hoisted(() => vi.fn())

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
vi.mock('@/service/apps', () => ({
  createApp: vi.fn(),
}))
vi.mock('@/service/use-apps', () => ({
  useInvalidateAppList: () => mockInvalidateAppList,
}))
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
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>open-icon-picker</button>
  ),
}))
vi.mock('@/utils/app-redirection', () => ({
  getRedirection: vi.fn(),
}))
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))
vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})
vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => '/guides',
}))
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

const mockUseRouter = vi.mocked(useRouter)
const mockPush = vi.fn()
const mockCreateApp = vi.mocked(createApp)
const mockTrackCreateApp = vi.mocked(trackCreateApp)
const mockGetRedirection = vi.mocked(getRedirection)
const mockUseProviderContext = vi.mocked(useProviderContext)
const { mockToastSuccess, mockToastError } = toastMocks

const defaultPlanUsage = {
  buildApps: 0,
  teamMembers: 0,
  annotatedResponse: 0,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
  vectorSpace: 0,
}

const renderModal = () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const onCreateFromTemplate = vi.fn()
  render(
    <CreateAppModal
      show
      onClose={onClose}
      onSuccess={onSuccess}
      onCreateFromTemplate={onCreateFromTemplate}
      defaultAppMode={AppModeEnum.ADVANCED_CHAT}
    />,
  )
  return { onClose, onSuccess, onCreateFromTemplate }
}

describe('CreateAppModal', () => {
  const mockSetItem = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ahooksMocks.keyPressHandlers.length = 0
    mockUseRouter.mockReturnValue({ push: mockPush } as unknown as ReturnType<typeof useRouter>)
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: AppModeEnum.ADVANCED_CHAT,
        usage: defaultPlanUsage,
        total: { ...defaultPlanUsage, buildApps: 1 },
        reset: {},
      },
      enableBilling: true,
    } as unknown as ReturnType<typeof useProviderContext>)
    mockUseAppContext.mockReturnValue({
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: ['app.create_and_management'],
    })
    mockAppContextState.userProfile = { id: 'user-1' }
    mockAppContextState.workspacePermissionKeys = ['app.create_and_management']
    mockSetItem.mockClear()
    Object.defineProperty(window, 'localStorage', {
      value: {
        setItem: mockSetItem,
        getItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      },
      writable: true,
    })
  })

  it('creates an app, notifies success, and fires callbacks', async () => {
    const mockApp: Partial<App> = { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT, maintainer: 'user-1' }
    mockCreateApp.mockResolvedValue(mockApp as App)
    const { onClose, onSuccess } = renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => expect(mockCreateApp).toHaveBeenCalledWith({
      name: 'My App',
      description: '',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#FFEAD5',
      mode: AppModeEnum.ADVANCED_CHAT,
    }))

    expect(mockTrackCreateApp).toHaveBeenCalledWith({ source: 'studio_blank', appMode: AppModeEnum.ADVANCED_CHAT })
    expect(mockToastSuccess).toHaveBeenCalledWith('app.newApp.appCreated')
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(mockSetItem).toHaveBeenCalledWith(NEED_REFRESH_APP_LIST_KEY, '1'))
    expect(mockInvalidateAppList).toHaveBeenCalledTimes(1)
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
    const mockApp: Partial<App> = { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT, maintainer: 'user-1' }
    let resolveTracking: (() => void) | undefined
    mockCreateApp.mockResolvedValue(mockApp as App)
    mockTrackCreateApp.mockReturnValue(new Promise<void>((resolve) => {
      resolveTracking = resolve
    }))
    renderModal()

    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Tracked App' },
    })
    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Create/ }))

    await waitFor(() => {
      expect(mockTrackCreateApp).toHaveBeenCalledWith({ source: 'studio_blank', appMode: AppModeEnum.ADVANCED_CHAT })
    })
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
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: AppModeEnum.ADVANCED_CHAT,
        usage: { ...defaultPlanUsage, buildApps: 1 },
        total: { ...defaultPlanUsage, buildApps: 1 },
        reset: {},
      },
      enableBilling: true,
    } as unknown as ReturnType<typeof useProviderContext>)

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
    fireEvent.click(screen.getByText('open-icon-picker'))
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
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: AppModeEnum.ADVANCED_CHAT,
        usage: { ...defaultPlanUsage, buildApps: 1 },
        total: { ...defaultPlanUsage, buildApps: 1 },
        reset: {},
      },
      enableBilling: true,
    } as unknown as ReturnType<typeof useProviderContext>)

    renderModal()

    fireEvent.click(screen.getByText('open-icon-picker'))
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
      expect(mockCreateApp).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Completion App',
        mode: AppModeEnum.COMPLETION,
      }))
    })
  })

  it('should ignore duplicate create clicks while a request is in flight', async () => {
    let resolveCreate: ((value: App) => void) | undefined
    mockCreateApp.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve as (value: App) => void
    }))
    renderModal()

    fireEvent.change(screen.getByPlaceholderText('app.newApp.appNamePlaceholder'), {
      target: { value: 'Slow App' },
    })

    const createButton = screen.getByRole('button', { name: /app\.newApp\.Create/ })
    fireEvent.click(createButton)
    fireEvent.click(createButton)

    expect(mockCreateApp).toHaveBeenCalledTimes(1)

    resolveCreate?.({ id: 'slow-app', mode: AppModeEnum.ADVANCED_CHAT } as App)
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('app.newApp.appCreated')
    })
  })
})
