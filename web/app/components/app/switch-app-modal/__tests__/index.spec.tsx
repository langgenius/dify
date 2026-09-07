import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import SwitchAppModal from '../index'

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useParams: () => ({}),
}))

// Use real store - global zustand mock will auto-reset between tests

const mockConvertToWorkflow = vi.hoisted(() => vi.fn())
const mockDeleteOriginalApp = vi.hoisted(() => vi.fn())
const mockMutationState = vi.hoisted(() => ({ hookIndex: 0 }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useMutation: () => {
      const mutationIndex = mockMutationState.hookIndex++ % 2
      return {
        mutateAsync: mutationIndex === 0 ? mockConvertToWorkflow : mockDeleteOriginalApp,
      }
    },
  }
})

let mockEnableBilling = false
let mockPlan = {
  type: 'sandbox',
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

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>open-icon-picker</button>
  ),
}))

const createMockApp = (overrides: Partial<AppPartial> = {}): AppPartial => ({
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
  created_at: Date.now(),
  updated_at: Date.now(),
  tags: [],
  access_mode: 'public_access',
  ...overrides,
})

const toastMocks = vi.hoisted(() => ({
  notify: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'success', message, ...options }),
    error: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'error', message, ...options }),
    warning: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'warning', message, ...options }),
    info: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'info', message, ...options }),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  },
}))

const renderComponent = (overrides: Partial<React.ComponentProps<typeof SwitchAppModal>> = {}) => {
  const onClose = vi.fn()
  const appDetail = createMockApp()

  const utils = render(
    <SwitchAppModal show appDetail={appDetail} onClose={onClose} {...overrides} />,
  )

  return {
    ...utils,
    notify: toastMocks.notify,
    onClose,
    appDetail,
  }
}

const setAppDetailSpy = vi.fn()

describe('SwitchAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutationState.hookIndex = 0
    mockConvertToWorkflow.mockReset()
    mockDeleteOriginalApp.mockReset()
    // Spy on setAppDetail
    const originalSetAppDetail = useAppStore.getState().setAppDetail
    setAppDetailSpy.mockImplementation((...args: Parameters<typeof originalSetAppDetail>) => {
      originalSetAppDetail(...args)
    })
    useAppStore.setState({ setAppDetail: setAppDetailSpy as typeof originalSetAppDetail })
    mockEnableBilling = false
    mockPlan = {
      type: 'sandbox',
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
      expect(
        document.querySelector('.i-custom-vender-solid-alertsAndFeedback-alert-triangle'),
      ).toBeInTheDocument()
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

    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      const { onClose } = renderComponent()

      await user.click(screen.getByRole('button', { name: /operation\.close$/ }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should switch app and navigate with push when keeping original', async () => {
      const user = userEvent.setup()
      // Arrange
      const { appDetail, notify, onClose } = renderComponent()
      mockConvertToWorkflow.mockResolvedValueOnce({
        new_app_id: 'new-app-001',
        permission_keys: ['app.acl.view_layout'],
      })

      // Act
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      // Assert
      await waitFor(() => {
        expect(mockConvertToWorkflow).toHaveBeenCalledWith({
          params: { app_id: appDetail.id },
          body: {
            name: 'Demo App(copy)',
            icon_type: 'emoji',
            icon: '🚀',
            icon_background: '#FFEAD5',
          },
        })
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(notify).toHaveBeenCalledWith({ type: 'success', message: 'app.newApp.appCreated' })
        expect(mockPush).toHaveBeenCalledWith('/app/new-app-001/workflow')
        expect(mockReplace).not.toHaveBeenCalled()
      })
    })

    it('should update the icon through the picker before switching apps', async () => {
      const user = userEvent.setup()
      const { appDetail } = renderComponent()
      mockConvertToWorkflow.mockResolvedValueOnce({
        new_app_id: 'new-app-003',
        permission_keys: ['app.acl.view_layout'],
      })

      await user.click(screen.getByText('open-icon-picker'))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: '#E4FBCC' }))
      await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      await waitFor(() => {
        expect(mockConvertToWorkflow).toHaveBeenCalledWith(
          expect.objectContaining({
            params: { app_id: appDetail.id },
            body: expect.objectContaining({
              icon_type: 'emoji',
              icon: '🚀',
              icon_background: '#E4FBCC',
            }),
          }),
        )
      })
    })

    it('should close the icon picker and reset remove-original confirmation when cancelled', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByText('open-icon-picker'))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /iconPicker\.cancel/ }))
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
      })
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()

      await user.click(screen.getByText('app.removeOriginal'))
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(
        screen.queryByRole('button', { name: 'common.operation.confirm' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('checkbox')).not.toBeChecked()
    })

    it('should toggle remove-original from the checkbox control itself', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByRole('checkbox'))

      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeInTheDocument()
    })

    it('should delete the original app and use replace when remove original is confirmed', async () => {
      const user = userEvent.setup()
      // Arrange
      const { appDetail } = renderComponent({ inAppDetail: true })
      mockConvertToWorkflow.mockResolvedValueOnce({
        new_app_id: 'new-app-002',
        permission_keys: ['app.acl.view_layout'],
      })

      // Act
      await user.click(screen.getByText('app.removeOriginal'))
      const confirmButton = await screen.findByRole('button', { name: 'common.operation.confirm' })
      await user.click(confirmButton)
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      // Assert
      await waitFor(() => {
        expect(mockDeleteOriginalApp).toHaveBeenCalledWith({
          params: { app_id: appDetail.id },
        })
      })
      expect(mockReplace).toHaveBeenCalledWith('/app/new-app-002/workflow')
      expect(mockPush).not.toHaveBeenCalled()
      expect(setAppDetailSpy).toHaveBeenCalledTimes(1)
    })

    it('should notify error when switch app fails', async () => {
      const user = userEvent.setup()
      // Arrange
      const { notify, onClose } = renderComponent()
      mockConvertToWorkflow.mockRejectedValueOnce(new Error('fail'))

      // Act
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      // Assert
      await waitFor(() => {
        expect(notify).toHaveBeenCalledWith({
          type: 'error',
          message: 'app.newApp.appCreateFailed',
        })
      })
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
