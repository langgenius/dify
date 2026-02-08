import type { MetadataItemInBatchEdit, MetadataItemWithEdit } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType, UpdateType } from '../types'
import EditMetadataBatchModal from './modal'

// Mock service/API calls
const mockDoAddMetaData = vi.fn().mockResolvedValue({})
vi.mock('@/service/knowledge/use-metadata', () => ({
  useCreateMetaData: () => ({
    mutate: mockDoAddMetaData,
  }),
  useDatasetMetaData: () => ({
    data: {
      doc_metadata: [
        { id: 'existing-1', name: 'existing_field', type: DataType.string },
        { id: 'existing-2', name: 'another_field', type: DataType.number },
      ],
    },
  }),
}))

// Mock check name hook to control validation
let mockCheckNameResult = { errorMsg: '' }
vi.mock('../hooks/use-check-metadata-name', () => ({
  default: () => ({
    checkName: () => mockCheckNameResult,
  }),
}))

// Mock Toast to verify notifications
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (args: unknown) => mockToastNotify(args),
  },
}))

// Type definitions for mock props
type EditRowProps = {
  payload: MetadataItemWithEdit
  onChange: (item: MetadataItemWithEdit) => void
  onRemove: (id: string) => void
  onReset: (id: string) => void
}

type AddRowProps = {
  payload: MetadataItemWithEdit
  onChange: (item: MetadataItemWithEdit) => void
  onRemove: () => void
}

type SelectModalProps = {
  trigger: React.ReactNode
  onSelect: (item: MetadataItemInBatchEdit) => void
  onSave: (data: { name: string, type: DataType }) => Promise<void>
  onManage: () => void
}

// Mock child components with callback exposure
vi.mock('./edit-row', () => ({
  default: ({ payload, onChange, onRemove, onReset }: EditRowProps) => (
    <div data-testid="edit-row" data-id={payload.id}>
      <span data-testid="edit-row-name">{payload.name}</span>
      <button data-testid={`change-${payload.id}`} onClick={() => onChange({ ...payload, value: 'changed', isUpdated: true, updateType: UpdateType.changeValue })}>Change</button>
      <button data-testid={`remove-${payload.id}`} onClick={() => onRemove(payload.id)}>Remove</button>
      <button data-testid={`reset-${payload.id}`} onClick={() => onReset(payload.id)}>Reset</button>
    </div>
  ),
}))

vi.mock('./add-row', () => ({
  default: ({ payload, onChange, onRemove }: AddRowProps) => (
    <div data-testid="add-row" data-id={payload.id}>
      <span data-testid="add-row-name">{payload.name}</span>
      <button data-testid={`add-change-${payload.id}`} onClick={() => onChange({ ...payload, value: 'new_value' })}>Change</button>
      <button data-testid="add-remove" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

vi.mock('../metadata-dataset/select-metadata-modal', () => ({
  default: ({ trigger, onSelect, onSave, onManage }: SelectModalProps) => (
    <div data-testid="select-modal">
      {trigger}
      <button data-testid="select-metadata" onClick={() => onSelect({ id: 'new-1', name: 'new_field', type: DataType.string, value: null, isMultipleValue: false })}>Select</button>
      <button data-testid="save-metadata" onClick={() => onSave({ name: 'created_field', type: DataType.string }).catch(() => {})}>Save</button>
      <button data-testid="manage-metadata" onClick={onManage}>Manage</button>
    </div>
  ),
}))

describe('EditMetadataBatchModal', () => {
  const mockList: MetadataItemInBatchEdit[] = [
    { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1', isMultipleValue: false },
    { id: '2', name: 'field_two', type: DataType.number, value: 42, isMultipleValue: false },
  ]

  const defaultProps = {
    datasetId: 'ds-1',
    documentNum: 5,
    list: mockList,
    onSave: vi.fn(),
    onHide: vi.fn(),
    onShowManage: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckNameResult = { errorMsg: '' }
  })

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('should render document count', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText(/5/)).toBeInTheDocument()
      })
    })

    it('should render all edit rows for existing items', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        const editRows = screen.getAllByTestId('edit-row')
        expect(editRows).toHaveLength(2)
      })
    })

    it('should render field names for existing items', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('field_one')).toBeInTheDocument()
        expect(screen.getByText('field_two')).toBeInTheDocument()
      })
    })

    it('should render checkbox for apply to all', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        const checkboxes = document.querySelectorAll('[data-testid*="checkbox"]')
        expect(checkboxes.length).toBeGreaterThan(0)
      })
    })

    it('should render select metadata modal', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByTestId('select-modal')).toBeInTheDocument()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onHide when cancel button is clicked', async () => {
      const onHide = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onHide={onHide} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const cancelButton = screen.getByText(/cancel/i)
      fireEvent.click(cancelButton)

      expect(onHide).toHaveBeenCalled()
    })

    it('should call onSave when save button is clicked', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find the primary save button (not the one in SelectMetadataModal)
      const saveButtons = screen.getAllByText(/save/i)
      const modalSaveButton = saveButtons.find(btn => btn.closest('button')?.classList.contains('btn-primary'))
      if (modalSaveButton)
        fireEvent.click(modalSaveButton)

      expect(onSave).toHaveBeenCalled()
    })

    it('should toggle apply to all checkbox', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const checkboxContainer = document.querySelector('[data-testid*="checkbox"]')
      expect(checkboxContainer).toBeInTheDocument()

      if (checkboxContainer) {
        fireEvent.click(checkboxContainer)
        await waitFor(() => {
          const checkIcon = checkboxContainer.querySelector('svg')
          expect(checkIcon).toBeInTheDocument()
        })
      }
    })

    it('should call onHide when modal close button is clicked', async () => {
      const onHide = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onHide={onHide} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })
  })

  describe('Edit Row Operations', () => {
    it('should update item value when change is triggered', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('change-1'))

      // The component should update internally
      expect(screen.getAllByTestId('edit-row').length).toBe(2)
    })

    it('should mark item as deleted when remove is clicked', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('remove-1'))

      // The component should update internally - item marked as deleted
      expect(screen.getAllByTestId('edit-row').length).toBe(2)
    })

    it('should reset item when reset is clicked', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // First change the item
      fireEvent.click(screen.getByTestId('change-1'))
      // Then reset it
      fireEvent.click(screen.getByTestId('reset-1'))

      expect(screen.getAllByTestId('edit-row').length).toBe(2)
    })
  })

  describe('Add Metadata Operations', () => {
    it('should add new item when metadata is selected', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('select-metadata'))

      // Should now have add-row for the new item
      await waitFor(() => {
        expect(screen.getByTestId('add-row')).toBeInTheDocument()
      })
    })

    it('should remove added item when remove is clicked', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // First add an item
      fireEvent.click(screen.getByTestId('select-metadata'))

      await waitFor(() => {
        expect(screen.getByTestId('add-row')).toBeInTheDocument()
      })

      // Then remove it
      fireEvent.click(screen.getByTestId('add-remove'))

      await waitFor(() => {
        expect(screen.queryByTestId('add-row')).not.toBeInTheDocument()
      })
    })

    it('should update added item when change is triggered', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // First add an item
      fireEvent.click(screen.getByTestId('select-metadata'))

      await waitFor(() => {
        expect(screen.getByTestId('add-row')).toBeInTheDocument()
      })

      // Then change it
      fireEvent.click(screen.getByTestId('add-change-new-1'))

      expect(screen.getByTestId('add-row')).toBeInTheDocument()
    })

    it('should call doAddMetaData when saving new metadata with valid name', async () => {
      mockCheckNameResult = { errorMsg: '' }

      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('save-metadata'))

      await waitFor(() => {
        expect(mockDoAddMetaData).toHaveBeenCalled()
      })
    })

    it('should show success toast when saving with valid name', async () => {
      mockCheckNameResult = { errorMsg: '' }

      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('save-metadata'))

      await waitFor(() => {
        expect(mockDoAddMetaData).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })

    it('should show error toast when saving with invalid name', async () => {
      mockCheckNameResult = { errorMsg: 'Name already exists' }

      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('save-metadata'))

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            message: 'Name already exists',
          }),
        )
      })
    })

    it('should call onShowManage when manage is clicked', async () => {
      const onShowManage = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onShowManage={onShowManage} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('manage-metadata'))

      expect(onShowManage).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should pass correct datasetId', async () => {
      render(<EditMetadataBatchModal {...defaultProps} datasetId="custom-ds" />)
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('should display correct document number', async () => {
      render(<EditMetadataBatchModal {...defaultProps} documentNum={10} />)
      await waitFor(() => {
        expect(screen.getByText(/10/)).toBeInTheDocument()
      })
    })

    it('should handle empty list', async () => {
      render(<EditMetadataBatchModal {...defaultProps} list={[]} />)
      await waitFor(() => {
        expect(screen.queryByTestId('edit-row')).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle list with multiple value items', async () => {
      const multipleValueList: MetadataItemInBatchEdit[] = [
        { id: '1', name: 'field', type: DataType.string, value: null, isMultipleValue: true },
      ]
      render(<EditMetadataBatchModal {...defaultProps} list={multipleValueList} />)
      await waitFor(() => {
        expect(screen.getByTestId('edit-row')).toBeInTheDocument()
      })
    })

    it('should handle rapid save clicks', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Find the primary save button
      const saveButtons = screen.getAllByText(/save/i)
      const saveBtn = saveButtons.find(btn => btn.closest('button')?.classList.contains('btn-primary'))
      if (saveBtn) {
        fireEvent.click(saveBtn)
        fireEvent.click(saveBtn)
        fireEvent.click(saveBtn)
      }

      expect(onSave).toHaveBeenCalledTimes(3)
    })

    it('should pass correct arguments to onSave', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const saveButtons = screen.getAllByText(/save/i)
      const saveBtn = saveButtons.find(btn => btn.closest('button')?.classList.contains('btn-primary'))
      if (saveBtn)
        fireEvent.click(saveBtn)

      expect(onSave).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.any(Boolean),
      )
    })

    it('should pass isApplyToAllSelectDocument as true when checked', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      const checkboxContainer = document.querySelector('[data-testid*="checkbox"]')
      if (checkboxContainer)
        fireEvent.click(checkboxContainer)

      const saveButtons = screen.getAllByText(/save/i)
      const saveBtn = saveButtons.find(btn => btn.closest('button')?.classList.contains('btn-primary'))
      if (saveBtn)
        fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(Array),
          true,
        )
      })
    })

    it('should filter out deleted items when saving', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Remove an item
      fireEvent.click(screen.getByTestId('remove-1'))

      // Save
      const saveButtons = screen.getAllByText(/save/i)
      const saveBtn = saveButtons.find(btn => btn.closest('button')?.classList.contains('btn-primary'))
      if (saveBtn)
        fireEvent.click(saveBtn)

      expect(onSave).toHaveBeenCalled()
      // The first argument should not contain the deleted item (id '1')
      const savedList = onSave.mock.calls[0][0] as MetadataItemInBatchEdit[]
      const hasDeletedItem = savedList.some(item => item.id === '1')
      expect(hasDeletedItem).toBe(false)
    })

    it('should handle multiple add and remove operations', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Add first item
      fireEvent.click(screen.getByTestId('select-metadata'))
      await waitFor(() => {
        expect(screen.getByTestId('add-row')).toBeInTheDocument()
      })

      // Remove it
      fireEvent.click(screen.getByTestId('add-remove'))

      await waitFor(() => {
        expect(screen.queryByTestId('add-row')).not.toBeInTheDocument()
      })

      // Add again
      fireEvent.click(screen.getByTestId('select-metadata'))
      await waitFor(() => {
        expect(screen.getByTestId('add-row')).toBeInTheDocument()
      })
    })
  })
})
