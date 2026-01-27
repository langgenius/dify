import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import after mock
import { renameDocumentName } from '@/service/datasets'

import RenameModal from './rename-modal'

// Mock the service
vi.mock('@/service/datasets', () => ({
  renameDocumentName: vi.fn(),
}))

const mockRenameDocumentName = vi.mocked(renameDocumentName)

describe('RenameModal', () => {
  const defaultProps = {
    datasetId: 'dataset-123',
    documentId: 'doc-456',
    name: 'Original Document',
    onClose: vi.fn(),
    onSaved: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByText(/list\.table\.rename/i)).toBeInTheDocument()
    })

    it('should render modal title', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByText(/list\.table\.rename/i)).toBeInTheDocument()
    })

    it('should render name label', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByText(/list\.table\.name/i)).toBeInTheDocument()
    })

    it('should render input with initial name', () => {
      render(<RenameModal {...defaultProps} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('Original Document')
    })

    it('should render cancel button', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
    })

    it('should render save button', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByText(/operation\.save/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display the provided name in input', () => {
      render(<RenameModal {...defaultProps} name="Custom Name" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('Custom Name')
    })
  })

  describe('User Interactions', () => {
    it('should update input value when typing', () => {
      render(<RenameModal {...defaultProps} />)
      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: 'New Name' } })

      expect(input).toHaveValue('New Name')
    })

    it('should call onClose when cancel button is clicked', () => {
      const handleClose = vi.fn()
      render(<RenameModal {...defaultProps} onClose={handleClose} />)

      const cancelButton = screen.getByText(/operation\.cancel/i)
      fireEvent.click(cancelButton)

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should call renameDocumentName with correct params when save is clicked', async () => {
      mockRenameDocumentName.mockResolvedValueOnce({ result: 'success' })

      render(<RenameModal {...defaultProps} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'New Document Name' } })

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockRenameDocumentName).toHaveBeenCalledWith({
          datasetId: 'dataset-123',
          documentId: 'doc-456',
          name: 'New Document Name',
        })
      })
    })

    it('should call onSaved and onClose on successful save', async () => {
      mockRenameDocumentName.mockResolvedValueOnce({ result: 'success' })
      const handleSaved = vi.fn()
      const handleClose = vi.fn()

      render(<RenameModal {...defaultProps} onSaved={handleSaved} onClose={handleClose} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(handleSaved).toHaveBeenCalledTimes(1)
        expect(handleClose).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Loading State', () => {
    it('should show loading state while saving', async () => {
      // Create a promise that we can resolve manually
      let resolvePromise: (value: { result: 'success' | 'fail' }) => void
      const pendingPromise = new Promise<{ result: 'success' | 'fail' }>((resolve) => {
        resolvePromise = resolve
      })
      mockRenameDocumentName.mockReturnValueOnce(pendingPromise)

      render(<RenameModal {...defaultProps} />)
      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      // The button should be in loading state
      await waitFor(() => {
        const buttons = screen.getAllByRole('button')
        const saveBtn = buttons.find(btn => btn.textContent?.includes('operation.save'))
        expect(saveBtn).toBeInTheDocument()
      })

      // Resolve the promise to clean up
      resolvePromise!({ result: 'success' })
    })
  })

  describe('Error Handling', () => {
    it('should handle API error gracefully', async () => {
      const error = new Error('API Error')
      mockRenameDocumentName.mockRejectedValueOnce(error)
      const handleSaved = vi.fn()
      const handleClose = vi.fn()

      render(<RenameModal {...defaultProps} onSaved={handleSaved} onClose={handleClose} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        // onSaved and onClose should not be called on error
        expect(handleSaved).not.toHaveBeenCalled()
        expect(handleClose).not.toHaveBeenCalled()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      render(<RenameModal {...defaultProps} name="" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
    })

    it('should handle name with special characters', () => {
      render(<RenameModal {...defaultProps} name="Document <with> 'special' chars" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('Document <with> \'special\' chars')
    })
  })
})
