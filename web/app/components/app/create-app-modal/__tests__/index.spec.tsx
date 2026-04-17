import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
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

vi.mock('ahooks', () => ({
  useDebounceFn: <T extends (...args: unknown[]) => unknown>(fn: T) => {
    const run = (...args: Parameters<T>) => fn(...args)
    const cancel = vi.fn()
    const flush = vi.fn()
    return { run, cancel, flush }
  },
  useKeyPress: (_keys: unknown, handler: () => void) => {
    ahooksMocks.keyPressHandlers.push(handler)
  },
  useHover: () => false,
}))
vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
}))
vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: vi.fn(),
}))
vi.mock('@/service/apps', () => ({
  createApp: vi.fn(),
}))
const toastMocks = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))
vi.mock('@/app/components/base/ui/toast', () => ({
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
vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (payload: Record<string, unknown>) => void, onClose: () => void }) => (
    <div>
      <button
        type="button"
        onClick={() => onSelect({ type: 'image', fileId: 'file-1', url: 'https://example.com/icon.png' })}
      >
        select-image-icon
      </button>
      <button type="button" onClick={onClose}>close-icon-picker</button>
    </div>
  ),
}))
vi.mock('@/utils/app-redirection', () => ({
  getRedirection: vi.fn(),
}))
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))
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
const mockUseAppContext = vi.mocked(useAppContext)
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
      isCurrentWorkspaceEditor: true,
    } as unknown as ReturnType<typeof useAppContext>)
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
    const mockApp: Partial<App> = { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT }
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

    expect(mockTrackCreateApp).toHaveBeenCalledWith({ appMode: AppModeEnum.ADVANCED_CHAT })
    expect(mockToastSuccess).toHaveBeenCalledWith('app.newApp.appCreated')
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(mockSetItem).toHaveBeenCalledWith(NEED_REFRESH_APP_LIST_KEY, '1'))
    await waitFor(() => expect(mockGetRedirection).toHaveBeenCalledWith(true, mockApp, mockPush))
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

  it('creates a beginner chat app with the keyboard shortcut and selected image icon', async () => {
    mockCreateApp.mockResolvedValue({ id: 'chat-app', mode: AppModeEnum.CHAT } as App)
    renderModal()

    fireEvent.click(screen.getByText('app.newApp.forBeginners'))
    fireEvent.click(screen.getByText('app.types.chatbot'))
    fireEvent.click(screen.getByText('open-icon-picker'))
    fireEvent.click(screen.getByText('select-image-icon'))
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
        icon_type: 'image',
        icon: 'file-1',
        icon_background: undefined,
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

  it('ignores the keyboard shortcut when the app quota is exhausted and closes the icon picker', () => {
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
    expect(screen.getByText('select-image-icon')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-icon-picker'))

    expect(screen.queryByText('select-image-icon')).not.toBeInTheDocument()

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
