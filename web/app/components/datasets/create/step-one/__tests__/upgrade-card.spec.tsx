import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpgradeCard from '../upgrade-card'

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
      render(<UpgradeCard />)

      // Assert - title and description i18n keys are rendered
      expect(screen.getByText(/uploadMultipleFiles\.title/i)).toBeInTheDocument()
    })

    it('should render the upgrade title text', () => {
      render(<UpgradeCard />)

      expect(screen.getByText(/uploadMultipleFiles\.title/i)).toBeInTheDocument()
    })

    it('should render the upgrade description text', () => {
      render(<UpgradeCard />)

      expect(screen.getByText(/uploadMultipleFiles\.description/i)).toBeInTheDocument()
    })

    it('should render the upgrade button', () => {
      render(<UpgradeCard />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call setShowPricingModal when upgrade button is clicked', () => {
      render(<UpgradeCard />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should not call setShowPricingModal without user interaction', () => {
      render(<UpgradeCard />)

      expect(mockSetShowPricingModal).not.toHaveBeenCalled()
    })

    it('should call setShowPricingModal on each button click', () => {
      render(<UpgradeCard />)

      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(2)
    })
  })

  describe('Memoization', () => {
    it('should maintain rendering after rerender with same props', () => {
      const { rerender } = render(<UpgradeCard />)

      rerender(<UpgradeCard />)

      expect(screen.getByText(/uploadMultipleFiles\.title/i)).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
