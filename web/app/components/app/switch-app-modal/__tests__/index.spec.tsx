import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
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

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useMutation: (options: Parameters<typeof actual.useMutation>[0]) => {
      const key = JSON.stringify(options.mutationKey)
      return actual.useMutation({
        ...options,
        ...(key.includes('convertToWorkflow')
          ? { mutationFn: (input: unknown) => mockConvertToWorkflow(input) }
          : key.includes('delete')
            ? { mutationFn: (input: unknown) => mockDeleteOriginalApp(input) }
            : {}),
      })
    },
  }
})

let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'COMMUNITY'
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

vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: ({ loc }: { loc: string }) => (
    <div data-testid="apps-full">
      AppsFull
      {loc}
    </div>
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
  mode: 'completion' as const,
  created_at: Date.now(),
  updated_at: Date.now(),
  tags: [],
  access_mode: 'public',
  ...overrides,
})

const toastMocks = vi.hoisted(() => ({
  notify: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
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
  const onOpenChange = vi.fn()
  const appDetail = createMockApp()

  const utils = render(
    <SwitchAppModal open sourceApp={appDetail} onOpenChange={onOpenChange} {...overrides} />,
  )

  return {
    ...utils,
    notify: toastMocks.notify,
    onOpenChange,
    appDetail,
  }
}

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { apps: { size: mockPlan.usage.buildApps, limit: mockPlan.total.buildApps } },
  })
}

describe('SwitchAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvertToWorkflow.mockReset()
    mockDeleteOriginalApp.mockReset()
    deploymentEdition = 'COMMUNITY'
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
      renderComponent({ open: false })

      // Assert
      expect(screen.queryByText('app.switch')).not.toBeInTheDocument()
    })
  })

  // Prop-driven UI states such as disabling actions.
  describe('Props', () => {
    it('should validate blank names and submit the current field value with Enter', async () => {
      const user = userEvent.setup()
      renderComponent()
      const nameInput = screen.getByRole('textbox', { name: 'app.newApp.name' })
      expect(screen.getByRole('group', { name: 'app.switchLabel' })).toContainElement(nameInput)
      await user.clear(nameInput)
      await user.type(nameInput, '   {Enter}')
      expect(await screen.findByText('explore.appCustomize.nameRequired')).toBeVisible()
      expect(mockConvertToWorkflow).not.toHaveBeenCalled()
      mockConvertToWorkflow.mockResolvedValue({ new_app_id: 'converted-app' })
      await user.clear(nameInput)
      await user.type(nameInput, 'Renamed workflow{Enter}')
      await waitFor(() =>
        expect(mockConvertToWorkflow).toHaveBeenCalledWith(
          expect.objectContaining({ body: expect.objectContaining({ name: 'Renamed workflow' }) }),
        ),
      )
    })

    it('should render the apps full warning when plan limits are reached', () => {
      // Arrange
      deploymentEdition = 'CLOUD'
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
    it('should call onOpenChange when cancel is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      const { onOpenChange } = renderComponent()

      // Act
      await user.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))

      // Assert
      expect(onOpenChange).toHaveBeenCalledTimes(1)
    })

    it('should call onOpenChange when close button is clicked', async () => {
      const user = userEvent.setup()
      const { onOpenChange } = renderComponent()

      await user.click(screen.getByRole('button', { name: /operation\.close$/ }))

      expect(onOpenChange).toHaveBeenCalledTimes(1)
    })

    it('should switch app and navigate with push when keeping original', async () => {
      const user = userEvent.setup()
      // Arrange
      const { appDetail, onOpenChange } = renderComponent()
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
        expect(onOpenChange).toHaveBeenCalledTimes(1)
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

      await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))

      await waitFor(() => {
        expect(mockConvertToWorkflow).toHaveBeenCalledWith(
          expect.objectContaining({
            params: { app_id: appDetail.id },
            body: expect.objectContaining({
              icon_type: 'emoji',
              icon: '🚀',
              icon_background: '#F3FEE7',
            }),
          }),
        )
      })
    })

    it('should close the icon picker and reset remove-original confirmation when cancelled', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
      })
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()

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
      const { appDetail } = renderComponent()
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
    })

    it('keeps conversion pending until original deletion settles and navigates to the created app if deletion fails', async () => {
      const user = userEvent.setup()
      const { onOpenChange, notify } = renderComponent()
      mockConvertToWorkflow.mockResolvedValueOnce({
        new_app_id: 'converted-app',
        permission_keys: ['app.acl.view_layout'],
      })
      let rejectDeletion: (error: Error) => void = () => {}
      mockDeleteOriginalApp.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectDeletion = reject
          }),
      )
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))
      await waitFor(() => expect(mockDeleteOriginalApp).toHaveBeenCalledTimes(1))
      await user.keyboard('{Escape}')
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'app.switchStart' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      await user.click(screen.getByRole('button', { name: 'app.switchStart' }))
      expect(mockConvertToWorkflow).toHaveBeenCalledTimes(1)
      await act(async () => rejectDeletion(new Error('Failed to delete original')))
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app/converted-app/workflow'))
      expect(notify).toHaveBeenCalledWith({ type: 'error', message: 'app.appDeleteFailed' })
      expect(mockConvertToWorkflow).toHaveBeenCalledTimes(1)
    })

    it('should notify error when switch app fails', async () => {
      const user = userEvent.setup()
      // Arrange
      const { notify, onOpenChange } = renderComponent()
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
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  })
})

mockEmojiData()
