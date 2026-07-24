import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpgradeBtn from '../index'

// ✅ Import real project components (DO NOT mock these)
// PremiumBadge, Button, SparklesSoft are all base components

// ✅ Mock external dependencies only
const mockSetShowPricingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
}))

// Typed window accessor for gtag tracking tests
const gtagWindow = window as unknown as Record<string, Mock | undefined>
let mockGtag: Mock | undefined

describe('UpgradeBtn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGtag = vi.fn()
    gtagWindow.gtag = mockGtag
  })

  afterEach(() => {
    delete gtagWindow.gtag
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing with default props', () => {
      render(<UpgradeBtn />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render premium badge by default', () => {
      render(<UpgradeBtn />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render plain button when isPlain is true', () => {
      render(<UpgradeBtn isPlain />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(screen.getByText(/billing\.upgradeBtn\.plain/i)).toBeInTheDocument()
    })

    it('should render short text when isShort is true', () => {
      render(<UpgradeBtn isShort />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourageShort/i)).toBeInTheDocument()
    })

    it('should render custom label when labelKey is provided', () => {
      render(<UpgradeBtn labelKey="triggerLimitModal.upgrade" />)

      expect(screen.getByText(/triggerLimitModal\.upgrade/i)).toBeInTheDocument()
    })

    it('should render custom label in plain button when labelKey is provided with isPlain', () => {
      render(<UpgradeBtn isPlain labelKey="triggerLimitModal.upgrade" />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(screen.getByText(/triggerLimitModal\.upgrade/i)).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should apply custom className to premium badge', () => {
      const customClass = 'custom-upgrade-btn'

      const { container } = render(<UpgradeBtn className={customClass} />)

      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveClass(customClass)
    })

    it('should apply custom className to plain button', () => {
      const customClass = 'custom-button-class'

      render(<UpgradeBtn isPlain className={customClass} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass(customClass)
    })

    it('should apply custom style to premium badge', () => {
      const customStyle = { padding: '10px' }

      const { container } = render(<UpgradeBtn style={customStyle} />)

      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveStyle(customStyle)
    })

    it('should apply custom style to plain button', () => {
      const customStyle = { margin: '5px' }

      render(<UpgradeBtn isPlain style={customStyle} />)

      const button = screen.getByRole('button')
      expect(button).toHaveStyle(customStyle)
    })

    it('should render with size "s"', () => {
      render(<UpgradeBtn size="s" />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render with size "m" by default', () => {
      render(<UpgradeBtn />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should render with size "custom"', () => {
      render(<UpgradeBtn size="custom" />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call custom onClick when provided and premium badge is clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<UpgradeBtn onClick={handleClick} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should call custom onClick when provided and plain button is clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<UpgradeBtn isPlain onClick={handleClick} />)
      const button = screen.getByRole('button')
      await user.click(button)

      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should open pricing modal when no custom onClick is provided and premium badge is clicked', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should open pricing modal when no custom onClick is provided and plain button is clicked', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn isPlain />)
      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should track gtag event when loc is provided and badge is clicked', async () => {
      const user = userEvent.setup()
      const loc = 'header-navigation'

      render(<UpgradeBtn loc={loc} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockGtag).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc,
      })
    })

    it('should track gtag event when loc is provided and plain button is clicked', async () => {
      const user = userEvent.setup()
      const loc = 'footer-section'

      render(<UpgradeBtn isPlain loc={loc} />)
      const button = screen.getByRole('button')
      await user.click(button)

      expect(mockGtag).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc,
      })
    })

    it('should not track gtag event when loc is not provided', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should not track gtag event when gtag is not available', async () => {
      const user = userEvent.setup()
      delete gtagWindow.gtag

      render(<UpgradeBtn loc="test-location" />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should call both custom onClick and track gtag when both are provided', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      const loc = 'settings-page'

      render(<UpgradeBtn onClick={handleClick} loc={loc} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

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
      render(<UpgradeBtn className={undefined} />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle undefined style', () => {
      render(<UpgradeBtn style={undefined} />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle undefined onClick', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn onClick={undefined} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should handle undefined loc', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn loc={undefined} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should handle undefined labelKey', () => {
      render(<UpgradeBtn labelKey={undefined} />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle empty string className', () => {
      render(<UpgradeBtn className="" />)

      expect(screen.getByText(/billing\.upgradeBtn\.encourage/i)).toBeInTheDocument()
    })

    it('should handle empty string loc', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn loc="" />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      expect(mockGtag).not.toHaveBeenCalled()
    })

    it('should handle labelKey with isShort - labelKey takes precedence', () => {
      render(<UpgradeBtn isShort labelKey="triggerLimitModal.title" />)

      expect(screen.getByText(/triggerLimitModal\.title/i)).toBeInTheDocument()
      expect(screen.queryByText(/billing\.upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    })
  })

  // Prop Combinations
  describe('Prop Combinations', () => {
    it('should handle isPlain with isShort', () => {
      render(<UpgradeBtn isPlain isShort />)

      expect(screen.getByText(/billing\.upgradeBtn\.plain/i)).toBeInTheDocument()
    })

    it('should handle isPlain with custom labelKey', () => {
      render(<UpgradeBtn isPlain labelKey="triggerLimitModal.upgrade" />)

      expect(screen.getByText(/triggerLimitModal\.upgrade/i)).toBeInTheDocument()
      expect(screen.queryByText(/billing\.upgradeBtn\.plain/i)).not.toBeInTheDocument()
    })

    it('should handle isShort with custom labelKey', () => {
      render(<UpgradeBtn isShort labelKey="triggerLimitModal.title" />)

      expect(screen.getByText(/triggerLimitModal\.title/i)).toBeInTheDocument()
      expect(screen.queryByText(/billing\.upgradeBtn\.encourageShort/i)).not.toBeInTheDocument()
    })

    it('should handle all custom props together', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      const customStyle = { margin: '10px' }
      const customClass = 'all-custom'

      const { container } = render(
        <UpgradeBtn
          className={customClass}
          style={customStyle}
          size="s"
          isShort
          onClick={handleClick}
          loc="test-loc"
          labelKey="triggerLimitModal.description"
        />,
      )
      const badge = screen.getByText(/triggerLimitModal\.description/i)
      await user.click(badge)

      const rootElement = container.firstChild as HTMLElement
      expect(rootElement).toHaveClass(customClass)
      expect(rootElement).toHaveStyle(customStyle)
      expect(screen.getByText(/triggerLimitModal\.description/i)).toBeInTheDocument()
      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
        loc: 'test-loc',
      })
    })
  })

  // Accessibility Tests
  describe('Accessibility', () => {
    it('should be keyboard accessible with plain button', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<UpgradeBtn isPlain onClick={handleClick} />)
      const button = screen.getByRole('button')

      // Tab to button
      await user.tab()
      expect(button).toHaveFocus()

      // Press Enter
      await user.keyboard('{Enter}')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should be keyboard accessible with Space key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<UpgradeBtn isPlain onClick={handleClick} />)

      // Tab to button and press Space
      await user.tab()
      await user.keyboard(' ')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should be clickable for premium badge variant', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<UpgradeBtn onClick={handleClick} />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)

      // Click badge
      await user.click(badge)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should have proper button role when isPlain is true', () => {
      render(<UpgradeBtn isPlain />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  // Integration Tests
  describe('Integration', () => {
    it('should work with modal context for pricing modal', async () => {
      const user = userEvent.setup()

      render(<UpgradeBtn />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      await waitFor(() => {
        expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
      })
    })

    it('should integrate onClick with analytics tracking', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<UpgradeBtn onClick={handleClick} loc="integration-test" />)
      const badge = screen.getByText(/billing\.upgradeBtn\.encourage/i)
      await user.click(badge)

      await waitFor(() => {
        expect(handleClick).toHaveBeenCalledTimes(1)
        expect(mockGtag).toHaveBeenCalledWith('event', 'click_upgrade_btn', {
          loc: 'integration-test',
        })
      })
    })
  })
})
