import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackEvent } from '@/app/components/base/amplitude'

import { ToastContext } from '@/app/components/base/toast'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { createApp } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import CreateAppModal from './index'

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: any[]) => any) => {
    const run = (...args: any[]) => fn(...args)
    const cancel = vi.fn()
    const flush = vi.fn()
    return { run, cancel, flush }
  },
  useKeyPress: vi.fn(),
  useHover: () => false,
}))
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))
vi.mock('@/service/apps', () => ({
  createApp: vi.fn(),
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

const mockNotify = vi.fn()
const mockUseRouter = vi.mocked(useRouter)
const mockPush = vi.fn()
const mockCreateApp = vi.mocked(createApp)
const mockTrackEvent = vi.mocked(trackEvent)
const mockGetRedirection = vi.mocked(getRedirection)
const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseAppContext = vi.mocked(useAppContext)

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
  render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      <CreateAppModal show onClose={onClose} onSuccess={onSuccess} defaultAppMode={AppModeEnum.ADVANCED_CHAT} />
    </ToastContext.Provider>,
  )
  return { onClose, onSuccess }
}

describe('CreateAppModal', () => {
  const mockSetItem = vi.fn()
  const originalLocalStorage = window.localStorage

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ push: mockPush } as any)
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: AppModeEnum.ADVANCED_CHAT,
        usage: defaultPlanUsage,
        total: { ...defaultPlanUsage, buildApps: 1 },
        reset: {},
      },
      enableBilling: true,
    } as any)
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as any)
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

  afterAll(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
    })
  })

  it('creates an app, notifies success, and fires callbacks', async () => {
    const mockApp = { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT }
    mockCreateApp.mockResolvedValue(mockApp as any)
    const { onClose, onSuccess } = renderModal()

    const nameInput = screen.getByPlaceholderText('app.newApp.appNamePlaceholder')
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Create' }))

    await waitFor(() => expect(mockCreateApp).toHaveBeenCalledWith({
      name: 'My App',
      description: '',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#FFEAD5',
      mode: AppModeEnum.ADVANCED_CHAT,
    }))

    expect(mockTrackEvent).toHaveBeenCalledWith('create_app', {
      app_mode: AppModeEnum.ADVANCED_CHAT,
      description: '',
    })
    expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'app.newApp.appCreated' })
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
    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Create' }))

    await waitFor(() => expect(mockCreateApp).toHaveBeenCalled())
    expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'boom' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
