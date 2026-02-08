import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DSLConfirmModal from './dsl-confirm-modal'

// ============================================================================
// DSLConfirmModal Component Tests
// ============================================================================

describe('DSLConfirmModal', () => {
  const defaultProps = {
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      expect(screen.getByText(/appCreateDSLErrorTitle/i)).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      expect(screen.getByText(/appCreateDSLErrorTitle/i)).toBeInTheDocument()
    })

    it('should render error message parts', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      expect(screen.getByText(/appCreateDSLErrorPart1/i)).toBeInTheDocument()
      expect(screen.getByText(/appCreateDSLErrorPart2/i)).toBeInTheDocument()
      expect(screen.getByText(/appCreateDSLErrorPart3/i)).toBeInTheDocument()
      expect(screen.getByText(/appCreateDSLErrorPart4/i)).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      expect(screen.getByText(/Cancel/i)).toBeInTheDocument()
    })

    it('should render confirm button', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      expect(screen.getByText(/Confirm/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Versions Display Tests
  // --------------------------------------------------------------------------
  describe('Versions Display', () => {
    it('should display imported version when provided', () => {
      render(
        <DSLConfirmModal
          {...defaultProps}
          versions={{ importedVersion: '1.0.0', systemVersion: '2.0.0' }}
        />,
      )
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
    })

    it('should display system version when provided', () => {
      render(
        <DSLConfirmModal
          {...defaultProps}
          versions={{ importedVersion: '1.0.0', systemVersion: '2.0.0' }}
        />,
      )
      expect(screen.getByText('2.0.0')).toBeInTheDocument()
    })

    it('should use default empty versions when not provided', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      // Should render without errors
      expect(screen.getByText(/appCreateDSLErrorTitle/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      const cancelButton = screen.getByText(/Cancel/i)

      fireEvent.click(cancelButton)

      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm when confirm button is clicked', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      const confirmButton = screen.getByText(/Confirm/i)

      fireEvent.click(confirmButton)

      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when modal is closed', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      // Modal close is triggered by clicking backdrop or close button
      // The onClose prop is mapped to onCancel
      const cancelButton = screen.getByText(/Cancel/i)
      fireEvent.click(cancelButton)

      expect(defaultProps.onCancel).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Button State Tests
  // --------------------------------------------------------------------------
  describe('Button State', () => {
    it('should enable confirm button by default', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      const confirmButton = screen.getByText(/Confirm/i)

      expect(confirmButton).not.toBeDisabled()
    })

    it('should disable confirm button when confirmDisabled is true', () => {
      render(<DSLConfirmModal {...defaultProps} confirmDisabled={true} />)
      const confirmButton = screen.getByText(/Confirm/i)

      expect(confirmButton).toBeDisabled()
    })

    it('should enable confirm button when confirmDisabled is false', () => {
      render(<DSLConfirmModal {...defaultProps} confirmDisabled={false} />)
      const confirmButton = screen.getByText(/Confirm/i)

      expect(confirmButton).not.toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have button container with proper styling', () => {
      render(<DSLConfirmModal {...defaultProps} />)
      const cancelButton = screen.getByText(/Cancel/i)
      const buttonContainer = cancelButton.parentElement
      expect(buttonContainer).toHaveClass('flex', 'items-start', 'justify-end', 'gap-2')
    })
  })
})
