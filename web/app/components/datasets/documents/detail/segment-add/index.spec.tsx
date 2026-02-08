import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Plan } from '@/app/components/billing/type'

import SegmentAdd, { ProcessStatus } from './index'

// Mock provider context
let mockPlan = { type: Plan.professional }
let mockEnableBilling = true
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: mockPlan,
    enableBilling: mockEnableBilling,
  }),
}))

// Mock PlanUpgradeModal
vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  default: ({ show, onClose, title, description }: { show: boolean, onClose: () => void, title?: string, description?: string }) => (
    show
      ? (
          <div data-testid="plan-upgrade-modal">
            <span data-testid="modal-title">{title}</span>
            <span data-testid="modal-description">{description}</span>
            <button onClick={onClose} data-testid="close-modal">Close</button>
          </div>
        )
      : null
  ),
}))

// Mock Popover
vi.mock('@/app/components/base/popover', () => ({
  default: ({ htmlContent, btnElement, disabled }: { htmlContent: ReactNode, btnElement: ReactNode, disabled?: boolean }) => (
    <div data-testid="popover">
      <button data-testid="popover-btn" disabled={disabled}>
        {btnElement}
      </button>
      <div data-testid="popover-content">{htmlContent}</div>
    </div>
  ),
}))

describe('SegmentAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlan = { type: Plan.professional }
    mockEnableBilling = true
  })

  const defaultProps = {
    importStatus: undefined as ProcessStatus | string | undefined,
    clearProcessStatus: vi.fn(),
    showNewSegmentModal: vi.fn(),
    showBatchModal: vi.fn(),
    embedding: false,
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<SegmentAdd {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render add button when no importStatus', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} />)

      // Assert
      expect(screen.getByText(/list\.action\.addButton/i)).toBeInTheDocument()
    })

    it('should render popover for batch add', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('popover')).toBeInTheDocument()
    })
  })

  // Import Status displays
  describe('Import Status Display', () => {
    it('should show processing indicator when status is WAITING', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.WAITING} />)

      // Assert
      expect(screen.getByText(/list\.batchModal\.processing/i)).toBeInTheDocument()
    })

    it('should show processing indicator when status is PROCESSING', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.PROCESSING} />)

      // Assert
      expect(screen.getByText(/list\.batchModal\.processing/i)).toBeInTheDocument()
    })

    it('should show completed status with ok button', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.COMPLETED} />)

      // Assert
      expect(screen.getByText(/list\.batchModal\.completed/i)).toBeInTheDocument()
      expect(screen.getByText(/list\.batchModal\.ok/i)).toBeInTheDocument()
    })

    it('should show error status with ok button', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.ERROR} />)

      // Assert
      expect(screen.getByText(/list\.batchModal\.error/i)).toBeInTheDocument()
      expect(screen.getByText(/list\.batchModal\.ok/i)).toBeInTheDocument()
    })

    it('should not show add button when importStatus is set', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.PROCESSING} />)

      // Assert
      expect(screen.queryByText(/list\.action\.addButton/i)).not.toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call showNewSegmentModal when add button is clicked', () => {
      // Arrange
      const mockShowNewSegmentModal = vi.fn()
      render(<SegmentAdd {...defaultProps} showNewSegmentModal={mockShowNewSegmentModal} />)

      // Act
      fireEvent.click(screen.getByText(/list\.action\.addButton/i))

      // Assert
      expect(mockShowNewSegmentModal).toHaveBeenCalledTimes(1)
    })

    it('should call clearProcessStatus when ok is clicked on completed status', () => {
      // Arrange
      const mockClearProcessStatus = vi.fn()
      render(
        <SegmentAdd
          {...defaultProps}
          importStatus={ProcessStatus.COMPLETED}
          clearProcessStatus={mockClearProcessStatus}
        />,
      )

      // Act
      fireEvent.click(screen.getByText(/list\.batchModal\.ok/i))

      // Assert
      expect(mockClearProcessStatus).toHaveBeenCalledTimes(1)
    })

    it('should call clearProcessStatus when ok is clicked on error status', () => {
      // Arrange
      const mockClearProcessStatus = vi.fn()
      render(
        <SegmentAdd
          {...defaultProps}
          importStatus={ProcessStatus.ERROR}
          clearProcessStatus={mockClearProcessStatus}
        />,
      )

      // Act
      fireEvent.click(screen.getByText(/list\.batchModal\.ok/i))

      // Assert
      expect(mockClearProcessStatus).toHaveBeenCalledTimes(1)
    })

    it('should render batch add option in popover', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} />)

      // Assert
      expect(screen.getByText(/list\.action\.batchAdd/i)).toBeInTheDocument()
    })

    it('should call showBatchModal when batch add is clicked', () => {
      // Arrange
      const mockShowBatchModal = vi.fn()
      render(<SegmentAdd {...defaultProps} showBatchModal={mockShowBatchModal} />)

      // Act
      fireEvent.click(screen.getByText(/list\.action\.batchAdd/i))

      // Assert
      expect(mockShowBatchModal).toHaveBeenCalledTimes(1)
    })
  })

  // Disabled state (embedding)
  describe('Embedding State', () => {
    it('should disable add button when embedding is true', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} embedding={true} />)

      // Assert
      const addButton = screen.getByText(/list\.action\.addButton/i).closest('button')
      expect(addButton).toBeDisabled()
    })

    it('should disable popover button when embedding is true', () => {
      // Arrange & Act
      render(<SegmentAdd {...defaultProps} embedding={true} />)

      // Assert
      expect(screen.getByTestId('popover-btn')).toBeDisabled()
    })

    it('should apply disabled styling when embedding is true', () => {
      // Arrange & Act
      const { container } = render(<SegmentAdd {...defaultProps} embedding={true} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('border-components-button-secondary-border-disabled')
    })
  })

  // Plan upgrade modal
  describe('Plan Upgrade Modal', () => {
    it('should show plan upgrade modal when sandbox user tries to add', () => {
      // Arrange
      mockPlan = { type: Plan.sandbox }
      render(<SegmentAdd {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByText(/list\.action\.addButton/i))

      // Assert
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })

    it('should not call showNewSegmentModal for sandbox users', () => {
      // Arrange
      mockPlan = { type: Plan.sandbox }
      const mockShowNewSegmentModal = vi.fn()
      render(<SegmentAdd {...defaultProps} showNewSegmentModal={mockShowNewSegmentModal} />)

      // Act
      fireEvent.click(screen.getByText(/list\.action\.addButton/i))

      // Assert
      expect(mockShowNewSegmentModal).not.toHaveBeenCalled()
    })

    it('should allow add when billing is disabled regardless of plan', () => {
      // Arrange
      mockPlan = { type: Plan.sandbox }
      mockEnableBilling = false
      const mockShowNewSegmentModal = vi.fn()
      render(<SegmentAdd {...defaultProps} showNewSegmentModal={mockShowNewSegmentModal} />)

      // Act
      fireEvent.click(screen.getByText(/list\.action\.addButton/i))

      // Assert
      expect(mockShowNewSegmentModal).toHaveBeenCalledTimes(1)
    })

    it('should close plan upgrade modal when close button is clicked', () => {
      // Arrange
      mockPlan = { type: Plan.sandbox }
      render(<SegmentAdd {...defaultProps} />)

      // Show modal
      fireEvent.click(screen.getByText(/list\.action\.addButton/i))
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()

      // Act
      fireEvent.click(screen.getByTestId('close-modal'))

      // Assert
      expect(screen.queryByTestId('plan-upgrade-modal')).not.toBeInTheDocument()
    })
  })

  // Progress bar width tests
  describe('Progress Bar', () => {
    it('should show 3/12 width progress bar for WAITING status', () => {
      // Arrange & Act
      const { container } = render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.WAITING} />)

      // Assert
      const progressBar = container.querySelector('.w-3\\/12')
      expect(progressBar).toBeInTheDocument()
    })

    it('should show 2/3 width progress bar for PROCESSING status', () => {
      // Arrange & Act
      const { container } = render(<SegmentAdd {...defaultProps} importStatus={ProcessStatus.PROCESSING} />)

      // Assert
      const progressBar = container.querySelector('.w-2\\/3')
      expect(progressBar).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle unknown importStatus string', () => {
      // Arrange & Act - pass unknown status
      const { container } = render(<SegmentAdd {...defaultProps} importStatus="unknown" />)

      // Assert - empty fragment is rendered for unknown status (container exists but has no visible content)
      expect(container).toBeInTheDocument()
      expect(container.textContent).toBe('')
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<SegmentAdd {...defaultProps} />)

      // Act
      rerender(<SegmentAdd {...defaultProps} embedding={true} />)

      // Assert
      const addButton = screen.getByText(/list\.action\.addButton/i).closest('button')
      expect(addButton).toBeDisabled()
    })

    it('should handle callback change', () => {
      // Arrange
      const mockShowNewSegmentModal1 = vi.fn()
      const mockShowNewSegmentModal2 = vi.fn()
      const { rerender } = render(
        <SegmentAdd {...defaultProps} showNewSegmentModal={mockShowNewSegmentModal1} />,
      )

      // Act
      rerender(<SegmentAdd {...defaultProps} showNewSegmentModal={mockShowNewSegmentModal2} />)
      fireEvent.click(screen.getByText(/list\.action\.addButton/i))

      // Assert
      expect(mockShowNewSegmentModal1).not.toHaveBeenCalled()
      expect(mockShowNewSegmentModal2).toHaveBeenCalledTimes(1)
    })
  })
})
