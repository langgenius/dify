import type { App } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { AppModeEnum } from '@/types/app'
import SwitchAppModal from './index'

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

// Use real store - global zustand mock will auto-reset between tests

const mockSwitchApp = vi.fn()
const mockDeleteApp = vi.fn()
vi.mock('@/service/apps', () => ({
  switchApp: (...args: unknown[]) => mockSwitchApp(...args),
  deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
}))

let mockIsEditor = true
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsEditor,
    userProfile: {
      email: 'user@example.com',
    },
    langGeniusVersionInfo: {
      current_version: '1.0.0',
    },
  }),
}))

let mockEnableBilling = false
let mockPlan = {
  type: Plan.sandbox,
  usage: {
    buildApps: 0,
    teamMembers: 0,
    annotatedResponse: 0,
    documentsUploadQuota: 0,
    apiRateLimit: 0,
    triggerEvents: 0,
    vectorSpace: 0,
  },
  total: {
    buildApps: 10,
    teamMembers: 0,
    annotatedResponse: 0,
    documentsUploadQuota: 0,
    apiRateLimit: 0,
    triggerEvents: 0,
    vectorSpace: 0,
  },
}
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: mockPlan,
    enableBilling: mockEnableBilling,
  }),
}))

vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: ({ loc }: { loc: string }) => (
    <div data-testid="apps-full">
      AppsFull
      {loc}
    </div>
  ),
}))

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: 'app-123',
  name: 'Demo App',
  description: 'Demo description',
  author_name: 'Demo author',
  icon_type: 'emoji',
  icon: '🚀',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: AppModeEnum.COMPLETION,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: Date.now(),
  updated_at: Date.now(),
  site: {
    access_token: 'token',
    app_base_url: 'https://example.com',
  } as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
})

const renderComponent = (overrides: Partial<React.ComponentProps<typeof SwitchAppModal>> = {}) => {
  const notify = vi.fn()
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const appDetail = createMockApp()

  const utils = render(
    <ToastContext.Provider value={{ notify, close: vi.fn() }}>
      <SwitchAppModal
        show
        appDetail={appDetail}
        onClose={onClose}
        onSuccess={onSuccess}
        {...overrides}
      />
    </ToastContext.Provider>,
  )

  return {
    ...utils,
    notify,
    onClose,
    onSuccess,
    appDetail,
  }
}

const setAppDetailSpy = vi.fn()

describe('SwitchAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Spy on setAppDetail
    const originalSetAppDetail = useAppStore.getState().setAppDetail
    setAppDetailSpy.mockImplementation((...args: Parameters<typeof originalSetAppDetail>) => {
      originalSetAppDetail(...args)
    })
    useAppStore.setState({ setAppDetail: setAppDetailSpy as typeof originalSetAppDetail })
    mockIsEditor = true
    mockEnableBilling = false
    mockPlan = {
      type: Plan.sandbox,
      usage: {
        buildApps: 0,
        teamMembers: 0,
        annotatedResponse: 0,
        documentsUploadQuota: 0,
        apiRateLimit: 0,
        triggerEvents: 0,
        vectorSpace: 0,
      },
      total: {
        buildApps: 10,
        teamMembers: 0,
        annotatedResponse: 0,
        documentsUploadQuota: 0,
        apiRateLimit: 0,
        triggerEvents: 0,
        vectorSpace: 0,
      },
    }
  })

  // Rendering behavior for modal visibility and default values.
  describe('Rendering', () => {
    it('should render modal content when show is true', () => {
      // Arrange
      renderComponent()

      // Assert
      expect(screen.getByText('app.switch')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Demo App(copy)')).toBeInTheDocument()
    })

    it('should not render modal content when show is false', () => {
      // Arrange
      renderComponent({ show: false })

      // Assert
      expect(screen.queryByText('app.switch')).not.toBeInTheDocument()
    })
  })

  // Prop-driven UI states such as disabling actions.
  describe('Props', () => {
    it('should disable the start button when name is empty', async () => {
      const user = userEvent.setup()
      // Arrange
      renderComponent()

      // Act
      const nameInput = screen.getByDisplayValue('Demo App(copy)')
      await user.clear(nameInput)

      // Assert
      expect(screen.getByRole('button', { name: 'app.switchStart' })).toBeDisabled()
    })

    it('should render the apps full warning when plan limits are reached', () => {
      // Arrange
      mockEnableBilling = true
      mockPlan = {
        ...mockPlan,
        usage: { ...mockPlan.usage, buildApps: 10 },
        total: { ...mockPlan.total, buildApps: 10 },
      }
      renderComponent()

      // Assert
      expect(screen.getByTestId('apps-full')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'app.switchStart' })).toBeDisabled()
    })
  })

  // User interactions that trigger navigation and API calls.
  describe('Interactions', () => {
    it('should call onClose when cancel is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      const { onClose } = renderComponent()

      // Act
      await user.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should switch app and navigate with push when keeping original', async () => {
      const user = userEvent.setup()
      // Arrange
      const { appDetail, notify, onClose, onSuccess } = renderComponent()
      mockSwitchApp.mockResolvedValueOnce({ new_app_id: 'new-app-001' })

      // Act
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      // Assert
      await waitFor(() => {
        expect(mockSwitchApp).toHaveBeenCalledWith({
          appID: appDetail.id,
          name: 'Demo App(copy)',
          icon_type: 'emoji',
          icon: '🚀',
          icon_background: '#FFEAD5',
        })
        expect(onSuccess).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(notify).toHaveBeenCalledWith({ type: 'success', message: 'app.newApp.appCreated' })
        expect(localStorage.setItem).toHaveBeenCalledWith(NEED_REFRESH_APP_LIST_KEY, '1')
        expect(mockPush).toHaveBeenCalledWith('/app/new-app-001/workflow')
        expect(mockReplace).not.toHaveBeenCalled()
      })
    })

    it('should delete the original app and use replace when remove original is confirmed', async () => {
      const user = userEvent.setup()
      // Arrange
      const { appDetail } = renderComponent({ inAppDetail: true })
      mockSwitchApp.mockResolvedValueOnce({ new_app_id: 'new-app-002' })

      // Act
      await user.click(screen.getByText('app.removeOriginal'))
      const confirmButton = await screen.findByRole('button', { name: 'common.operation.confirm' })
      await user.click(confirmButton)
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      // Assert
      await waitFor(() => {
        expect(mockDeleteApp).toHaveBeenCalledWith(appDetail.id)
      })
      expect(mockReplace).toHaveBeenCalledWith('/app/new-app-002/workflow')
      expect(mockPush).not.toHaveBeenCalled()
      expect(setAppDetailSpy).toHaveBeenCalledTimes(1)
    })

    it('should notify error when switch app fails', async () => {
      const user = userEvent.setup()
      // Arrange
      const { notify, onClose, onSuccess } = renderComponent()
      mockSwitchApp.mockRejectedValueOnce(new Error('fail'))

      // Act
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      // Assert
      await waitFor(() => {
        expect(notify).toHaveBeenCalledWith({ type: 'error', message: 'app.newApp.appCreateFailed' })
      })
      expect(onClose).not.toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
    })
  })
})
