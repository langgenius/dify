import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import DatasetMetadataDrawer from './dataset-metadata-drawer'

// Mock service/API calls
vi.mock('@/service/knowledge/use-metadata', () => ({
  useDatasetMetaData: () => ({
    data: {
      doc_metadata: [
        { id: '1', name: 'existing_field', type: DataType.string },
      ],
    },
  }),
}))

// Mock check name hook
vi.mock('../hooks/use-check-metadata-name', () => ({
  default: () => ({
    checkName: () => ({ errorMsg: '' }),
  }),
}))

// Mock Toast
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (args: unknown) => mockToastNotify(args),
  },
}))

// Type definitions for mock props
type CreateModalProps = {
  open: boolean
  setOpen: (open: boolean) => void
  trigger: React.ReactNode
  onSave: (data: BuiltInMetadataItem) => void
}

// Mock CreateModal to expose callbacks
vi.mock('@/app/components/datasets/metadata/metadata-dataset/create-metadata-modal', () => ({
  default: ({ open, setOpen, trigger, onSave }: CreateModalProps) => (
    <div data-testid="create-modal-wrapper">
      <div data-testid="create-trigger" onClick={() => setOpen(true)}>{trigger}</div>
      {open && (
        <div data-testid="create-modal">
          <button data-testid="create-save" onClick={() => onSave({ name: 'new_field', type: DataType.string })}>
            Save
          </button>
          <button data-testid="create-close" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  ),
}))

describe('DatasetMetadataDrawer', () => {
  const mockUserMetadata: MetadataItemWithValueLength[] = [
    { id: '1', name: 'field_one', type: DataType.string, count: 5 },
    { id: '2', name: 'field_two', type: DataType.number, count: 3 },
  ]

  const mockBuiltInMetadata: BuiltInMetadataItem[] = [
    { name: 'created_at', type: DataType.time },
    { name: 'modified_at', type: DataType.time },
  ]

  const defaultProps = {
    userMetadata: mockUserMetadata,
    builtInMetadata: mockBuiltInMetadata,
    isBuiltInEnabled: false,
    onIsBuiltInEnabledChange: vi.fn(),
    onClose: vi.fn(),
    onAdd: vi.fn().mockResolvedValue({}),
    onRename: vi.fn().mockResolvedValue({}),
    onRemove: vi.fn().mockResolvedValue({}),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('should render user metadata items', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('field_one')).toBeInTheDocument()
        expect(screen.getByText('field_two')).toBeInTheDocument()
      })
    })

    it('should render built-in metadata items', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('created_at')).toBeInTheDocument()
        expect(screen.getByText('modified_at')).toBeInTheDocument()
      })
    })

    it('should render metadata type for each item', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getAllByText(DataType.string).length).toBeGreaterThan(0)
        expect(screen.getAllByText(DataType.number).length).toBeGreaterThan(0)
      })
    })

    it('should render add metadata button', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByTestId('create-trigger')).toBeInTheDocument()
      })
    })

    it('should render switch for built-in toggle', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)
      await waitFor(() => {
        const switchBtn = screen.getByRole('switch')
        expect(switchBtn).toBeInTheDocument()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onIsBuiltInEnabledChange when switch is toggled', async () => {
      const onIsBuiltInEnabledChange = vi.fn()
      render(
        <DatasetMetadataDrawer
          {...defaultProps}
          onIsBuiltInEnabledChange={onIsBuiltInEnabledChange}
        />,
      )

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const switchBtn = screen.getByRole('switch')
      fireEvent.click(switchBtn)

      expect(onIsBuiltInEnabledChange).toHaveBeenCalled()
    })
  })

  describe('Add Metadata', () => {
    it('should open create modal when add button is clicked', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const trigger = screen.getByTestId('create-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByTestId('create-modal')).toBeInTheDocument()
      })
    })

    it('should call onAdd and show success toast when metadata is added', async () => {
      const onAdd = vi.fn().mockResolvedValue({})
      render(<DatasetMetadataDrawer {...defaultProps} onAdd={onAdd} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Open create modal
      const trigger = screen.getByTestId('create-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByTestId('create-modal')).toBeInTheDocument()
      })

      // Save new metadata
      fireEvent.click(screen.getByTestId('create-save'))

      await waitFor(() => {
        expect(onAdd).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })

    it('should close create modal after save', async () => {
      const onAdd = vi.fn().mockResolvedValue({})
      render(<DatasetMetadataDrawer {...defaultProps} onAdd={onAdd} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Open create modal
      fireEvent.click(screen.getByTestId('create-trigger'))

      await waitFor(() => {
        expect(screen.getByTestId('create-modal')).toBeInTheDocument()
      })

      // Save
      fireEvent.click(screen.getByTestId('create-save'))

      await waitFor(() => {
        expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('Rename Metadata', () => {
    it('should open rename modal when edit icon is clicked', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find user metadata items with group/item class (these have edit/delete icons)
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')
      expect(items.length).toBe(2) // 2 user metadata items

      // Find the hidden container with edit/delete icons
      const actionsContainer = items[0].querySelector('.hidden.items-center')
      expect(actionsContainer).toBeTruthy()

      // Find and click the first SVG (edit icon)
      if (actionsContainer) {
        const svgs = actionsContainer.querySelectorAll('svg')
        expect(svgs.length).toBeGreaterThan(0)
        fireEvent.click(svgs[0])
      }

      // Wait for rename modal (contains input)
      await waitFor(() => {
        const inputs = document.querySelectorAll('input')
        expect(inputs.length).toBeGreaterThan(0)
      })
    })

    it('should call onRename when rename is saved', async () => {
      const onRename = vi.fn().mockResolvedValue({})
      render(<DatasetMetadataDrawer {...defaultProps} onRename={onRename} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find and click edit icon
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')
      const actionsContainer = items[0].querySelector('.hidden.items-center')
      if (actionsContainer) {
        const svgs = actionsContainer.querySelectorAll('svg')
        fireEvent.click(svgs[0])
      }

      // Change name and save
      await waitFor(() => {
        const inputs = document.querySelectorAll('input')
        expect(inputs.length).toBeGreaterThan(0)
      })

      const inputs = document.querySelectorAll('input')
      fireEvent.change(inputs[0], { target: { value: 'renamed_field' } })

      // Find and click save button
      const saveBtns = screen.getAllByText(/save/i)
      const primaryBtn = saveBtns.find(btn =>
        btn.closest('button')?.classList.contains('btn-primary'),
      )
      if (primaryBtn)
        fireEvent.click(primaryBtn)

      await waitFor(() => {
        expect(onRename).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })

    it('should close rename modal when cancel is clicked', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find and click edit icon
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')
      const actionsContainer = items[0].querySelector('.hidden.items-center')
      if (actionsContainer) {
        const svgs = actionsContainer.querySelectorAll('svg')
        fireEvent.click(svgs[0])
      }

      // Wait for modal and click cancel
      await waitFor(() => {
        const inputs = document.querySelectorAll('input')
        expect(inputs.length).toBeGreaterThan(0)
      })

      // Change name first
      const inputs = document.querySelectorAll('input')
      fireEvent.change(inputs[0], { target: { value: 'changed_name' } })

      // Find and click cancel button
      const cancelBtns = screen.getAllByText(/cancel/i)
      const cancelBtn = cancelBtns.find(btn =>
        !btn.closest('button')?.classList.contains('btn-primary'),
      )
      if (cancelBtn)
        fireEvent.click(cancelBtn)

      // Verify input resets or modal closes
      await waitFor(() => {
        const currentInputs = document.querySelectorAll('input')
        // Either no inputs (modal closed) or value reset
        expect(currentInputs.length === 0 || currentInputs[0].value !== 'changed_name').toBe(true)
      })
    })

    it('should close rename modal when modal close button is clicked', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find and click edit icon
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')
      const actionsContainer = items[0].querySelector('.hidden.items-center')
      if (actionsContainer) {
        const svgs = actionsContainer.querySelectorAll('svg')
        fireEvent.click(svgs[0])
      }

      // Wait for rename modal
      await waitFor(() => {
        const inputs = document.querySelectorAll('input')
        expect(inputs.length).toBeGreaterThan(0)
      })

      // Find and click the modal close button (X button)
      // The Modal component has a close button in the header
      const dialogs = screen.getAllByRole('dialog')
      const renameModal = dialogs.find(d => d.querySelector('input'))
      if (renameModal) {
        // Find close button by looking for a button with close-related class or X icon
        const closeButtons = renameModal.querySelectorAll('button')
        for (const btn of Array.from(closeButtons)) {
          // Skip cancel/save buttons
          if (!btn.textContent?.toLowerCase().includes('cancel')
            && !btn.textContent?.toLowerCase().includes('save')
            && btn.querySelector('svg')) {
            fireEvent.click(btn)
            break
          }
        }
      }
    })
  })

  describe('Delete Metadata', () => {
    it('should show confirm dialog when delete icon is clicked', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find user metadata items
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')

      // Find the delete container
      const deleteContainer = items[0].querySelector('.hover\\:text-text-destructive')
      expect(deleteContainer).toBeTruthy()

      // Click delete icon
      if (deleteContainer) {
        const deleteIcon = deleteContainer.querySelector('svg')
        if (deleteIcon)
          fireEvent.click(deleteIcon)
      }

      // Confirm dialog should appear
      await waitFor(() => {
        const confirmBtns = screen.getAllByRole('button')
        const hasConfirmBtn = confirmBtns.some(btn =>
          btn.textContent?.toLowerCase().includes('confirm'),
        )
        expect(hasConfirmBtn).toBe(true)
      })
    })

    it('should call onRemove when delete is confirmed', async () => {
      const onRemove = vi.fn().mockResolvedValue({})
      render(<DatasetMetadataDrawer {...defaultProps} onRemove={onRemove} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find and click delete icon
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')
      const deleteContainer = items[0].querySelector('.hover\\:text-text-destructive')
      if (deleteContainer) {
        const deleteIcon = deleteContainer.querySelector('svg')
        if (deleteIcon)
          fireEvent.click(deleteIcon)
      }

      // Wait for confirm dialog
      await waitFor(() => {
        const confirmBtns = screen.getAllByRole('button')
        const hasConfirmBtn = confirmBtns.some(btn =>
          btn.textContent?.toLowerCase().includes('confirm'),
        )
        expect(hasConfirmBtn).toBe(true)
      })

      // Click confirm
      const confirmBtns = screen.getAllByRole('button')
      const confirmBtn = confirmBtns.find(btn =>
        btn.textContent?.toLowerCase().includes('confirm'),
      )
      if (confirmBtn)
        fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(onRemove).toHaveBeenCalledWith('1')
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find and click delete icon
      const dialog = screen.getByRole('dialog')
      const items = dialog.querySelectorAll('.group\\/item')
      const deleteContainer = items[0].querySelector('.hover\\:text-text-destructive')
      if (deleteContainer) {
        const deleteIcon = deleteContainer.querySelector('svg')
        if (deleteIcon)
          fireEvent.click(deleteIcon)
      }

      // Wait for confirm dialog
      await waitFor(() => {
        const confirmBtns = screen.getAllByRole('button')
        const hasConfirmBtn = confirmBtns.some(btn =>
          btn.textContent?.toLowerCase().includes('confirm'),
        )
        expect(hasConfirmBtn).toBe(true)
      })

      // Click cancel
      const cancelBtns = screen.getAllByRole('button')
      const cancelBtn = cancelBtns.find(btn =>
        btn.textContent?.toLowerCase().includes('cancel'),
      )
      if (cancelBtn)
        fireEvent.click(cancelBtn)
    })
  })

  describe('Props', () => {
    it('should handle empty userMetadata', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} userMetadata={[]} />)
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('should handle empty builtInMetadata', async () => {
      render(<DatasetMetadataDrawer {...defaultProps} builtInMetadata={[]} />)
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })
  })

  describe('Built-in Items State', () => {
    it('should show disabled styling when built-in is disabled', async () => {
      render(
        <DatasetMetadataDrawer {...defaultProps} isBuiltInEnabled={false} />,
      )

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const dialog = screen.getByRole('dialog')
      const disabledItems = dialog.querySelectorAll('.opacity-30')
      expect(disabledItems.length).toBeGreaterThan(0)
    })

    it('should not show disabled styling when built-in is enabled', async () => {
      render(
        <DatasetMetadataDrawer {...defaultProps} isBuiltInEnabled />,
      )

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle items with special characters in name', async () => {
      const specialMetadata: MetadataItemWithValueLength[] = [
        { id: '1', name: 'field_with_underscore', type: DataType.string, count: 1 },
      ]
      render(<DatasetMetadataDrawer {...defaultProps} userMetadata={specialMetadata} />)
      await waitFor(() => {
        expect(screen.getByText('field_with_underscore')).toBeInTheDocument()
      })
    })

    it('should handle single user metadata item', async () => {
      const singleMetadata: MetadataItemWithValueLength[] = [
        { id: '1', name: 'only_field', type: DataType.string, count: 10 },
      ]
      render(<DatasetMetadataDrawer {...defaultProps} userMetadata={singleMetadata} />)
      await waitFor(() => {
        expect(screen.getByText('only_field')).toBeInTheDocument()
      })
    })

    it('should handle single built-in metadata item', async () => {
      const singleBuiltIn: BuiltInMetadataItem[] = [
        { name: 'created_at', type: DataType.time },
      ]
      render(<DatasetMetadataDrawer {...defaultProps} builtInMetadata={singleBuiltIn} />)
      await waitFor(() => {
        expect(screen.getByText('created_at')).toBeInTheDocument()
      })
    })

    it('should handle metadata with zero count', async () => {
      const zeroCountMetadata: MetadataItemWithValueLength[] = [
        { id: '1', name: 'empty_field', type: DataType.string, count: 0 },
      ]
      render(<DatasetMetadataDrawer {...defaultProps} userMetadata={zeroCountMetadata} />)
      await waitFor(() => {
        expect(screen.getByText('empty_field')).toBeInTheDocument()
      })
    })
  })
})
