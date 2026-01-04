import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpgradeBtn from './index'

// ✅ Import real project components (DO NOT mock these)
// PremiumBadge, Button, SparklesSoft are all base components

// ✅ Mock external dependencies only
const mockSetShowPricingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
}))

// Mock gtag for tracking tests
let mockGtag: Mock | undefined

describe('UpgradeBtn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGtag = vi.fn()
    ;(window as any).gtag = mockGtag
  })

  afterEach(() => {
    delete (window as any).gtag
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing with default props', () => {
      // Act
      render(<UpgradeBtn />)

      // Assert - should render with default text
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render premium badge by default', () => {
      // Act
      render(<UpgradeBtn />)

      // Assert - PremiumBadge renders with text content
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render plain button when isPlain is true', () => {
      // Act
      render(<UpgradeBtn isPlain />)

      // Assert - Button should be rendered with plain text
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(screen.getByText(/billing\.upgradeBtn\.plain/i)).toBeInTheDocument()
    })

    it('should render short text when isShort is true', () => {
      // Act
      render(<UpgradeBtn isShort />)

      // Assert
      expect(screen.getByText(/billing\.upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should render custom label when labelKey is provided', () => {
      // Act
      render(<UpgradeBtn labelKey={'custom.label.key' as any} />)

      // Assert
      expect(screen.getByText(/custom\.label\.key/i)).toBeInTheDocument()
    })

    it('should render custom label in plain button when labelKey is provided with isPlain', () => {
      // Act
      render(<UpgradeBtn isPlain labelKey={'custom.label.key' as any} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(screen.getByText(/custom\.label\.key/i)).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should apply custom className to premium badge', () => {
      // Arrange
      const customClass = 'custom-upgrade-btn'

      // Act
      const { container } = render(<UpgradeBtn className={customClass} />)

      // Assert - Check the root element has the custom class
      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveClass(customClass)
    })

    it('should apply custom className to plain button', () => {
      // Arrange
      const customClass = 'custom-button-class'

      // Act
      render(<UpgradeBtn isPlain className={customClass} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass(customClass)
    })

    it('should apply custom style to premium badge', () => {
      // Arrange
      const customStyle = { padding: '10px' }

      // Act
      const { container } = render(<UpgradeBtn style={customStyle} />)

      // Assert
      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveStyle(customStyle)
    })

    it('should apply custom style to plain button', () => {
      // Arrange
      const customStyle = { margin: '5px' }

      // Act
      render(<UpgradeBtn isPlain style={customStyle} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveStyle(customStyle)
    })

    it('should render with size "s"', () => {
      // Act
      render(<UpgradeBtn size="s" />)

      // Assert - Component renders successfully with size prop
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render with size "m" by default', () => {
      // Act
      render(<UpgradeBtn />)

      // Assert - Component renders successfully
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render with size "custom"', () => {
      // Act
      render(<UpgradeBtn size="custom" />)

      // Assert - Component renders successfully with custom size
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call custom onClick when provided and premium badge is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()

      // Act
      render(<UpgradeBtn onClick={handleClick} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should call custom onClick when provided and plain button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()

      // Act
      render(<UpgradeBtn isPlain onClick={handleClick} />)
      const button = screen.getByRole('button')
      await user.click(button)

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should open pricing modal when no custom onClick is provided and premium badge is clicked', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should open pricing modal when no custom onClick is provided and plain button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn isPlain />)
      const button = screen.getByRole('button')
      await user.click(button)

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should track gtag event when loc is provided and badge is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const loc = 'header-navigation'

      // Act
      render(<UpgradeBtn loc={loc} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert
      expect(mockGtag).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc,
      })
    })

    it('should track gtag event when loc is provided and plain button is clicked', async () => {
      // Arrange
      const user = userEvent.setup()
      const loc = 'footer-section'

      // Act
      render(<UpgradeBtn isPlain loc={loc} />)
      const button = screen.getByRole('button')
      await user.click(button)

      // Assert
      expect(mockGtag).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc,
      })
    })

    it('should not track gtag event when loc is not provided', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert
      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should not track gtag event when gtag is not available', async () => {
      // Arrange
      const user = userEvent.setup()
      delete (window as any).gtag

      // Act
      render(<UpgradeBtn loc="test-location" />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert - should not throw error
      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should call both custom onClick and track gtag when both are provided', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()
      const loc = 'settings-page'

      // Act
      render(<UpgradeBtn onClick={handleClick} loc={loc} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc,
      })
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle undefined className', () => {
      // Act
      render(<UpgradeBtn className={undefined} />)

      // Assert - should render without error
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle undefined style', () => {
      // Act
      render(<UpgradeBtn style={undefined} />)

      // Assert - should render without error
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle undefined onClick', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn onClick={undefined} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert - should fall back to setShowPricingModal
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should handle undefined loc', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn loc={undefined} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert - should not attempt to track gtag
      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should handle undefined labelKey', () => {
      // Act
      render(<UpgradeBtn labelKey={undefined} />)

      // Assert - should use default label
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle empty string className', () => {
      // Act
      render(<UpgradeBtn className="" />)

      // Assert
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle empty string loc', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn loc="" />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert - empty loc should not trigger gtag
      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should handle empty string labelKey', () => {
      // Act
      render(<UpgradeBtn labelKey={'' as any} />)

      // Assert - empty labelKey is falsy, so it falls back to default label
      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })
  })

  // Prop Combinations
  describe('Prop Combinations', () => {
    it('should handle isPlain with isShort', () => {
      // Act
      render(<UpgradeBtn isPlain isShort />)

      // Assert - isShort should not affect plain button text
      expect(screen.getByText(/billing\.upgradeBtn\.plain/i)).toBeInTheDocument()
    })

    it('should handle isPlain with custom labelKey', () => {
      // Act
      render(<UpgradeBtn isPlain labelKey={'custom.key' as any} />)

      // Assert - labelKey should override plain text
      expect(screen.getByText(/custom\.key/i)).toBeInTheDocument()
      expect(screen.queryByText(/billing\.upgradeBtn\.plain/i)).not.toBeInTheDocument()
    })

    it('should handle isShort with custom labelKey', () => {
      // Act
      render(<UpgradeBtn isShort labelKey={'custom.short.key' as any} />)

      // Assert - labelKey should override isShort behavior
      expect(screen.getByText(/custom\.short\.key/i)).toBeInTheDocument()
      expect(screen.queryByText(/billing\.upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    })

    it('should handle all custom props together', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()
      const customStyle = { margin: '10px' }
      const customClass = 'all-custom'

      // Act
      const { container } = render(
        <UpgradeBtn
          className={customClass}
          style={customStyle}
          size="s"
          isShort
          onClick={handleClick}
          loc="test-loc"
          labelKey={'custom.all' as any}
        />,
      )
      const badge = screen.getByText(/custom\.all/i)
      await user.click(badge)

      // Assert
      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveClass(customClass)
      expect(rootElement).toHaveStyle(customStyle)
      expect(screen.getByText(/custom\.all/i)).toBeInTheDocument()
      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc: 'test-loc',
      })
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should be keyboard accessible with plain button', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()

      // Act
      render(<UpgradeBtn isPlain onClick={handleClick} />)
      const button = screen.getByRole('button')

      // Tab to button
      await user.tab()
      expect(button).toHaveFocus()

      // Press Enter
      await user.keyboard('{Enter}')

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should be keyboard accessible with Space key', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()

      // Act
      render(<UpgradeBtn isPlain onClick={handleClick} />)

      // Tab to button and press Space
      await user.tab()
      await user.keyboard(' ')

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should be clickable for premium badge variant', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()

      // Act
      render(<UpgradeBtn onClick={handleClick} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)

      // Click badge
      await user.click(badge)

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should have proper button role when isPlain is true', () => {
      // Act
      render(<UpgradeBtn isPlain />)

      // Assert - Plain button should have button role
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  // Integration Tests
  describe('Integration', () => {
    it('should work with modal context for pricing modal', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act
      render(<UpgradeBtn />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert
      await waitFor(() => {
        expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
      })
    })

    it('should integrate onClick with analytics tracking', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = vi.fn()

      // Act
      render(<UpgradeBtn onClick={handleClick} loc="integration-test" />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      // Assert - Both onClick and gtag should be called
      await waitFor(() => {
        expect(handleClick).toHaveBeenCalledTimes(1)
        expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
          loc: 'integration-test',
        })
      })
    })
  })
})
