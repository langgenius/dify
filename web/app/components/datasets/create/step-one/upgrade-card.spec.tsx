import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpgradeCard from './upgrade-card'

const mockSetShowPricingModal = vi.fn()

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ onClick, className }: { onClick?: () => void, className?: string }) => (
    <button type="button" className={className} onClick={onClick} data-testid="upgrade-btn">
      upgrade
    </button>
  ),
}))

describe('UpgradeCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<UpgradeCard />)

      // Assert - title and description i18n keys are rendered
      expect(screen.getByText(/uploadMultipleFiles\.title/i)).toBeInTheDocument()
    })

    it('should render the upgrade title text', () => {
      // Arrange & Act
      render(<UpgradeCard />)

      // Assert
      expect(screen.getByText(/uploadMultipleFiles\.title/i)).toBeInTheDocument()
    })

    it('should render the upgrade description text', () => {
      // Arrange & Act
      render(<UpgradeCard />)

      // Assert
      expect(screen.getByText(/uploadMultipleFiles\.description/i)).toBeInTheDocument()
    })

    it('should render the upgrade button', () => {
      // Arrange & Act
      render(<UpgradeCard />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call setShowPricingModal when upgrade button is clicked', () => {
      // Arrange
      render(<UpgradeCard />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should not call setShowPricingModal without user interaction', () => {
      // Arrange & Act
      render(<UpgradeCard />)

      // Assert
      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should call setShowPricingModal on each button click', () => {
      // Arrange
      render(<UpgradeCard />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(2)
    })
  })

  describe('Memoization', () => {
    it('should maintain rendering after rerender with same props', () => {
      // Arrange
      const { rerender } = render(<UpgradeCard />)

      // Act
      rerender(<UpgradeCard />)

      // Assert
      expect(screen.getByText(/uploadMultipleFiles\.title/i)).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
