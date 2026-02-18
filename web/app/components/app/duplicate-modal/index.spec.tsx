import type { ProviderContextState } from '@/context/provider-context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import Toast from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { baseProviderContextValue } from '@/context/provider-context'
import DuplicateAppModal from './index'

const appsFullRenderSpy = vi.fn()
vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: ({ loc }: { loc: string }) => {
    appsFullRenderSpy(loc)
    return <div data-testid="apps-full">AppsFull</div>
  },
}))

const useProviderContextMock = vi.fn<() => ProviderContextState>()
vi.mock('@/context/provider-context', async () => {
  const actual = await vi.importActual('@/context/provider-context')
  return {
    ...actual,
    useProviderContext: () => useProviderContextMock(),
  }
})

const renderComponent = (overrides: Partial<React.ComponentProps<typeof DuplicateAppModal>> = {}) => {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const onHide = vi.fn()
  const props: React.ComponentProps<typeof DuplicateAppModal> = {
    appName: 'My App',
    icon_type: 'emoji',
    icon: '🚀',
    icon_background: '#FFEAD5',
    icon_url: null,
    show: true,
    onConfirm,
    onHide,
    ...overrides,
  }
  const utils = render(<DuplicateAppModal {...props} />)
  return {
    ...utils,
    onConfirm,
    onHide,
  }
}

const setupProviderContext = (overrides: Partial<ProviderContextState> = {}) => {
  useProviderContextMock.mockReturnValue({
    ...baseProviderContextValue,
    plan: {
      ...baseProviderContextValue.plan,
      type: Plan.sandbox,
      usage: {
        ...baseProviderContextValue.plan.usage,
        buildApps: 0,
      },
      total: {
        ...baseProviderContextValue.plan.total,
        buildApps: 10,
      },
    },
    enableBilling: false,
    ...overrides,
  } as ProviderContextState)
}

describe('DuplicateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProviderContext()
  })

  // Rendering output based on modal visibility.
  describe('Rendering', () => {
    it('should render modal content when show is true', () => {
      // Arrange
      renderComponent()

      // Assert
      expect(screen.getByText('app.duplicateTitle')).toBeInTheDocument()
      expect(screen.getByDisplayValue('My App')).toBeInTheDocument()
    })

    it('should not render modal content when show is false', () => {
      // Arrange
      renderComponent({ show: false })

      // Assert
      expect(screen.queryByText('app.duplicateTitle')).not.toBeInTheDocument()
    })
  })

  // Prop-driven states such as full plan handling.
  describe('Props', () => {
    it('should disable duplicate button and show apps full content when plan is full', () => {
      // Arrange
      setupProviderContext({
        enableBilling: true,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.sandbox,
          usage: { ...baseProviderContextValue.plan.usage, buildApps: 10 },
          total: { ...baseProviderContextValue.plan.total, buildApps: 10 },
        },
      })
      renderComponent()

      // Assert
      expect(screen.getByTestId('apps-full')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'app.duplicate' })).toBeDisabled()
    })
  })

  // User interactions for cancel and confirm flows.
  describe('Interactions', () => {
    it('should call onHide when cancel is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      const { onHide } = renderComponent()

      // Act
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should show error toast when name is empty', async () => {
      const user = userEvent.setup()
      const toastSpy = vi.spyOn(Toast, 'notify')
      // Arrange
      const { onConfirm, onHide } = renderComponent()

      // Act
      await user.clear(screen.getByDisplayValue('My App'))
      await user.click(screen.getByRole('button', { name: 'app.duplicate' }))

      // Assert
      expect(toastSpy).toHaveBeenCalledWith({ type: 'error', message: 'explore.appCustomize.nameRequired' })
      expect(onConfirm).not.toHaveBeenCalled()
      expect(onHide).not.toHaveBeenCalled()
    })

    it('should submit app info and hide modal when duplicate is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      const { onConfirm, onHide } = renderComponent()

      // Act
      await user.clear(screen.getByDisplayValue('My App'))
      await user.type(screen.getByRole('textbox'), 'New App')
      await user.click(screen.getByRole('button', { name: 'app.duplicate' }))

      // Assert
      expect(onConfirm).toHaveBeenCalledWith({
        name: 'New App',
        icon_type: 'emoji',
        icon: '🚀',
        icon_background: '#FFEAD5',
      })
      expect(onHide).toHaveBeenCalledTimes(1)
    })
  })
})
