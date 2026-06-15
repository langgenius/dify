import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Actions from '../actions'

describe('Actions', () => {
  const defaultProps = {
    onBack: vi.fn(),
    onProcess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verify both action buttons render with correct labels
  describe('Rendering', () => {
    it('should render back button and process button', () => {
      render(<Actions {...defaultProps} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(2)
      expect(screen.getByText('datasetPipeline.operations.dataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.saveAndProcess')).toBeInTheDocument()
    })
  })

  // User interactions: clicking back and process buttons
  describe('User Interactions', () => {
    it('should call onBack when back button clicked', () => {
      render(<Actions {...defaultProps} />)

      fireEvent.click(screen.getByText('datasetPipeline.operations.dataSource'))

      expect(defaultProps.onBack).toHaveBeenCalledOnce()
    })

    it('should call onProcess when process button clicked', () => {
      render(<Actions {...defaultProps} />)

      fireEvent.click(screen.getByText('datasetPipeline.operations.saveAndProcess'))

      expect(defaultProps.onProcess).toHaveBeenCalledOnce()
    })
  })

  // Props: disabled state for the process button
  describe('Props', () => {
    it('should disable process button when runDisabled is true', () => {
      render(<Actions {...defaultProps} runDisabled />)

      const processButton = screen.getByText('datasetPipeline.operations.saveAndProcess').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should enable process button when runDisabled is false', () => {
      render(<Actions {...defaultProps} runDisabled={false} />)

      const processButton = screen.getByText('datasetPipeline.operations.saveAndProcess').closest('button')
      expect(processButton).not.toBeDisabled()
    })

    it('should enable process button when runDisabled is undefined', () => {
      render(<Actions {...defaultProps} />)

      const processButton = screen.getByText('datasetPipeline.operations.saveAndProcess').closest('button')
      expect(processButton).not.toBeDisabled()
    })
  })
})
