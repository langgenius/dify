import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VersionMismatchModal from '../version-mismatch-modal'

describe('VersionMismatchModal', () => {
  const mockOnClose = vi.fn()
  const mockOnConfirm = vi.fn()

  const defaultVersions = {
    importedVersion: '0.8.0',
    systemVersion: '1.0.0',
  }

  const defaultProps = {
    isShow: true,
    versions: defaultVersions,
    onClose: mockOnClose,
    onConfirm: mockOnConfirm,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('should render dialog when isShow is true', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should not render dialog when isShow is false', () => {
      render(<VersionMismatchModal {...defaultProps} isShow={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render error title', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })

    it('should render all error description parts', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      expect(screen.getByText('app.newApp.appCreateDSLErrorPart1')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.appCreateDSLErrorPart2')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.appCreateDSLErrorPart3')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.appCreateDSLErrorPart4')).toBeInTheDocument()
    })

    it('should display imported and system version numbers', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      expect(screen.getByText('0.8.0')).toBeInTheDocument()
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
    })

    it('should render cancel and confirm buttons', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: /app\.newApp\.Cancel/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /app\.newApp\.Confirm/ })).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should call onClose when cancel button is clicked', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Cancel/ }))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm when confirm button is clicked', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.Confirm/ }))

      expect(mockOnConfirm).toHaveBeenCalledTimes(1)
    })
  })

  describe('button variants', () => {
    it('should render cancel button with secondary variant', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      const cancelBtn = screen.getByRole('button', { name: /app\.newApp\.Cancel/ })
      expect(cancelBtn).toHaveClass('btn-secondary')
    })

    it('should render confirm button with primary destructive variant', () => {
      render(<VersionMismatchModal {...defaultProps} />)

      const confirmBtn = screen.getByRole('button', { name: /app\.newApp\.Confirm/ })
      expect(confirmBtn).toHaveClass('btn-primary')
      expect(confirmBtn).toHaveClass('btn-destructive')
    })
  })

  describe('edge cases', () => {
    it('should handle undefined versions gracefully', () => {
      render(<VersionMismatchModal {...defaultProps} versions={undefined} />)

      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })

    it('should handle empty version strings', () => {
      const emptyVersions = { importedVersion: '', systemVersion: '' }
      render(<VersionMismatchModal {...defaultProps} versions={emptyVersions} />)

      expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
    })
  })
})
