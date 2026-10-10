import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
// Import after mock
import { renameDocumentName } from '@/service/datasets'
import { RenameModal } from '../rename-modal'

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

// Mock the service
vi.mock('@/service/datasets', () => ({
  renameDocumentName: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

const mockRenameDocumentName = vi.mocked(renameDocumentName)

describe('RenameModal', () => {
  const defaultProps = {
    open: true,
    datasetId: 'dataset-123',
    documentId: 'doc-456',
    name: 'Original Document',
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render modal title', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByText(/list\.table\.rename/i)).toBeInTheDocument()
    })

    it('should render name label', () => {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByRole('textbox', { name: /list\.table\.name/i })).toBeInTheDocument()
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

    it('should call onOpenChange when cancel button is clicked', () => {
      const handleClose = vi.fn()
      render(<RenameModal {...defaultProps} onOpenChange={handleClose} />)

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

    it('should call onSaved and onOpenChange on successful save', async () => {
      mockRenameDocumentName.mockResolvedValueOnce({ result: 'success' })
      const handleSaved = vi.fn()
      const handleClose = vi.fn()

      render(<RenameModal {...defaultProps} onSaved={handleSaved} onOpenChange={handleClose} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(handleSaved).toHaveBeenCalledTimes(1)
        expect(handleClose).toHaveBeenCalledTimes(1)
        expect(mockToastSuccess).toHaveBeenCalledWith(expect.any(String))
      })
    })
  })

  describe('Loading State', () => {
    it('should not submit again while saving', async () => {
      // Create a promise that we can resolve manually
      let resolvePromise: (value: { result: 'success' | 'fail' }) => void
      const pendingPromise = new Promise<{ result: 'success' | 'fail' }>((resolve) => {
        resolvePromise = resolve
      })
      mockRenameDocumentName.mockReturnValueOnce(pendingPromise)

      render(<RenameModal {...defaultProps} />)
      const user = userEvent.setup()
      const input = screen.getByRole('textbox', { name: /list\.table\.name/i })
      await user.click(input)
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(mockRenameDocumentName).toHaveBeenCalledTimes(1)
      })
      await user.keyboard('{Enter}')
      expect(mockRenameDocumentName).toHaveBeenCalledTimes(1)

      resolvePromise!({ result: 'success' })
      await waitFor(() => {
        expect(defaultProps.onOpenChange).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle API error gracefully', async () => {
      const error = new Error('API Error')
      mockRenameDocumentName.mockRejectedValueOnce(error)
      const handleSaved = vi.fn()
      const handleClose = vi.fn()

      render(<RenameModal {...defaultProps} onSaved={handleSaved} onOpenChange={handleClose} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        // onSaved and onOpenChange should not be called on error
        expect(handleSaved).not.toHaveBeenCalled()
        expect(handleClose).not.toHaveBeenCalled()
        expect(mockToastError).toHaveBeenCalledWith('Error: API Error')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      render(<RenameModal {...defaultProps} name="" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
      expect(input).toHaveAttribute('placeholder', 'common.placeholder.input')
    })

    it('should handle name with special characters', () => {
      render(<RenameModal {...defaultProps} name="Document <with> 'special' chars" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue("Document <with> 'special' chars")
    })
  })
  it('keeps the current draft while pending and allows retry after a failed request', async () => {
    const user = userEvent.setup()
    let rejectRequest!: (error: Error) => void
    const request = new Promise<{ result: 'success' | 'fail' }>((_resolve, reject) => {
      rejectRequest = reject
    })
    mockRenameDocumentName.mockReturnValueOnce(request)
    mockRenameDocumentName.mockResolvedValueOnce({ result: 'success' })
    render(<RenameModal {...defaultProps} />)
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Retry document')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(input).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}{Enter}')
    expect(defaultProps.onOpenChange).not.toHaveBeenCalled()
    expect(mockRenameDocumentName).toHaveBeenCalledTimes(1)

    await act(async () => rejectRequest(new Error('Rename failed')))
    expect(input).toHaveValue('Retry document')
    expect(input).not.toHaveAttribute('readonly')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false))
    expect(mockRenameDocumentName).toHaveBeenLastCalledWith({
      datasetId: 'dataset-123',
      documentId: 'doc-456',
      name: 'Retry document',
    })
  })

  it('discards a canceled draft and initializes the next session from the latest name', async () => {
    const user = userEvent.setup()
    function Owner() {
      const [open, setOpen] = useState(true)
      const [name, setName] = useState('Original Document')
      return (
        <>
          <button
            onClick={() => {
              setName('Updated document')
              setOpen(true)
            }}
          >
            Rename again
          </button>
          <RenameModal {...defaultProps} name={name} open={open} onOpenChange={setOpen} />
        </>
      )
    }
    render(<Owner />)
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Canceled draft')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Rename again' }))
    expect(screen.getByRole('textbox')).toHaveValue('Updated document')
  })

  it('closes after notifying the owner without awaiting its background refresh', async () => {
    const user = userEvent.setup()
    let resolveRefresh!: () => void
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    const order: string[] = []
    mockRenameDocumentName.mockResolvedValueOnce({ result: 'success' })
    const onSaved = vi.fn(() => {
      order.push('saved')
      return refresh
    })
    const onOpenChange = vi.fn(() => order.push('closed'))
    render(<RenameModal {...defaultProps} onSaved={onSaved} onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(order).toEqual(['saved', 'closed']))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await act(async () => resolveRefresh())
  })
})
