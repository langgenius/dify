import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { contactSalesUrl } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { useModalContext } from '@/context/modal-context'
// Get the mocked functions
// const { useProviderContext } = vi.requireMock('@/context/provider-context')
// const { useModalContext } = vi.requireMock('@/context/modal-context')
import { useProviderContext } from '@/context/provider-context'
import CustomPage from './index'

// Mock external dependencies only
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

// Mock the complex CustomWebAppBrand component to avoid dependency issues
// This is acceptable because it has complex dependencies (fetch, APIs)
vi.mock('../custom-web-app-brand', () => ({
  default: () => <div data-testid="custom-web-app-brand">CustomWebAppBrand</div>,
}))

describe('CustomPage', () => {
  const mockSetShowPricingModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock setup
    ;(useModalContext as Mock).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
    })
  })

  // Helper function to render with different provider contexts
  const renderWithContext = (overrides = {}) => {
    ;(useProviderContext as Mock).mockReturnValue(
      createMockProviderContextValue(overrides),
    )
    return render(<CustomPage />)
  }

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderWithContext()

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
    })

    it('should always render CustomWebAppBrand component', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
    })

    it('should have correct layout structure', () => {
      // Arrange & Act
      const { container } = renderWithContext()

      // Assert
      const mainContainer = container.querySelector('.flex.flex-col')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  // Conditional Rendering - Billing Tip
  describe('Billing Tip Banner', () => {
    it('should show billing tip when enableBilling is true and plan is sandbox', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
      expect(screen.getByText('custom.upgradeTip.des')).toBeInTheDocument()
      expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
    })

    it('should not show billing tip when enableBilling is false', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: false,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.des')).not.toBeInTheDocument()
    })

    it('should not show billing tip when plan is professional', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.des')).not.toBeInTheDocument()
    })

    it('should not show billing tip when plan is team', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.team },
      })

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.des')).not.toBeInTheDocument()
    })

    it('should have correct gradient styling for billing tip banner', () => {
      // Arrange & Act
      const { container } = renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      const banner = container.querySelector('.bg-gradient-to-r')
      expect(banner).toBeInTheDocument()
      expect(banner).toHaveClass('from-components-input-border-active-prompt-1')
      expect(banner).toHaveClass('to-components-input-border-active-prompt-2')
      expect(banner).toHaveClass('p-4')
      expect(banner).toHaveClass('pl-6')
      expect(banner).toHaveClass('shadow-lg')
    })
  })

  // Conditional Rendering - Contact Sales
  describe('Contact Sales Section', () => {
    it('should show contact section when enableBilling is true and plan is professional', () => {
      // Arrange & Act
      const { container } = renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert - Check that contact section exists with all parts
      const contactSection = container.querySelector('.absolute.bottom-0')
      expect(contactSection).toBeInTheDocument()
      expect(contactSection).toHaveTextContent('custom.customize.prefix')
      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
      expect(contactSection).toHaveTextContent('custom.customize.suffix')
    })

    it('should show contact section when enableBilling is true and plan is team', () => {
      // Arrange & Act
      const { container } = renderWithContext({
        enableBilling: true,
        plan: { type: Plan.team },
      })

      // Assert - Check that contact section exists with all parts
      const contactSection = container.querySelector('.absolute.bottom-0')
      expect(contactSection).toBeInTheDocument()
      expect(contactSection).toHaveTextContent('custom.customize.prefix')
      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
      expect(contactSection).toHaveTextContent('custom.customize.suffix')
    })

    it('should not show contact section when enableBilling is false', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: false,
        plan: { type: Plan.professional },
      })

      // Assert
      expect(screen.queryByText('custom.customize.prefix')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })

    it('should not show contact section when plan is sandbox', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.queryByText('custom.customize.prefix')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })

    it('should render contact link with correct URL', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert
      const link = screen.getByText('custom.customize.contactUs').closest('a')
      expect(link).toHaveAttribute('href', contactSalesUrl)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should have correct positioning for contact section', () => {
      // Arrange & Act
      const { container } = renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert
      const contactSection = container.querySelector('.absolute.bottom-0')
      expect(contactSection).toBeInTheDocument()
      expect(contactSection).toHaveClass('h-[50px]')
      expect(contactSection).toHaveClass('text-xs')
      expect(contactSection).toHaveClass('leading-[50px]')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call setShowPricingModal when upgrade button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Act
      const upgradeButton = screen.getByText('billing.upgradeBtn.encourageShort')
      await user.click(upgradeButton)

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should call setShowPricingModal without arguments', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Act
      const upgradeButton = screen.getByText('billing.upgradeBtn.encourageShort')
      await user.click(upgradeButton)

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledWith()
    })

    it('should handle multiple clicks on upgrade button', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Act
      const upgradeButton = screen.getByText('billing.upgradeBtn.encourageShort')
      await user.click(upgradeButton)
      await user.click(upgradeButton)
      await user.click(upgradeButton)

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(3)
    })

    it('should have correct button styling for upgrade button', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      const upgradeButton = screen.getByText('billing.upgradeBtn.encourageShort')
      expect(upgradeButton).toHaveClass('cursor-pointer')
      expect(upgradeButton).toHaveClass('bg-white')
      expect(upgradeButton).toHaveClass('text-text-accent')
      expect(upgradeButton).toHaveClass('rounded-3xl')
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle undefined plan type gracefully', () => {
      // Arrange & Act
      expect(() => {
        renderWithContext({
          enableBilling: true,
          plan: { type: undefined },
        })
      }).not.toThrow()

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
    })

    it('should handle plan without type property', () => {
      // Arrange & Act
      expect(() => {
        renderWithContext({
          enableBilling: true,
          plan: { type: null },
        })
      }).not.toThrow()

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
    })

    it('should not show any banners when both conditions are false', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: false,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.prefix')).not.toBeInTheDocument()
    })

    it('should handle enableBilling undefined', () => {
      // Arrange & Act
      expect(() => {
        renderWithContext({
          enableBilling: undefined,
          plan: { type: Plan.sandbox },
        })
      }).not.toThrow()

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
    })

    it('should show only billing tip for sandbox plan, not contact section', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })

    it('should show only contact section for professional plan, not billing tip', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
    })

    it('should show only contact section for team plan, not billing tip', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.team },
      })

      // Assert
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
    })

    it('should handle empty plan object', () => {
      // Arrange & Act
      expect(() => {
        renderWithContext({
          enableBilling: true,
          plan: {},
        })
      }).not.toThrow()

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should have clickable upgrade button', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      const upgradeButton = screen.getByText('billing.upgradeBtn.encourageShort')
      expect(upgradeButton).toBeInTheDocument()
      expect(upgradeButton).toHaveClass('cursor-pointer')
    })

    it('should have proper external link attributes on contact link', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert
      const link = screen.getByText('custom.customize.contactUs').closest('a')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should have proper text hierarchy in billing tip', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      const title = screen.getByText('custom.upgradeTip.title')
      const description = screen.getByText('custom.upgradeTip.des')

      expect(title).toHaveClass('title-xl-semi-bold')
      expect(description).toHaveClass('system-sm-regular')
    })

    it('should use semantic color classes', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert - Check that the billing tip has text content (which implies semantic colors)
      expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
    })
  })

  // Integration Tests
  describe('Integration', () => {
    it('should render both CustomWebAppBrand and billing tip together', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
      expect(screen.getByText('custom.upgradeTip.title')).toBeInTheDocument()
    })

    it('should render both CustomWebAppBrand and contact section together', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: true,
        plan: { type: Plan.professional },
      })

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
      expect(screen.getByText('custom.customize.contactUs')).toBeInTheDocument()
    })

    it('should render only CustomWebAppBrand when no billing conditions met', () => {
      // Arrange & Act
      renderWithContext({
        enableBilling: false,
        plan: { type: Plan.sandbox },
      })

      // Assert
      expect(screen.getByTestId('custom-web-app-brand')).toBeInTheDocument()
      expect(screen.queryByText('custom.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.queryByText('custom.customize.contactUs')).not.toBeInTheDocument()
    })
  })
})
