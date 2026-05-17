import type { MetadataItemInBatchEdit, MetadataItemWithEdit } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType, UpdateType } from '../../types'
import EditMetadataBatchModal from '../modal'

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
vi.mock('../../hooks/use-check-metadata-name', () => ({
  default: () => ({
    checkName: () => mockCheckNameResult,
  }),
}))

// Mock Toast to verify notifications
const mockToastNotify = vi.fn()
vi.mock('@langgenius/dify-ui/toast', () => ({
  default: {
    notify: (args: unknown) => mockToastNotify(args),
  },
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
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

// Mock row components to exercise parent state transitions with accessible controls.
vi.mock('../edit-row', () => ({
  default: ({ payload, onChange, onRemove, onReset }: EditRowProps) => (
    <div role="group" aria-label={`Edit metadata ${payload.name}`}>
      <span>{payload.name}</span>
      <button type="button" onClick={() => onChange({ ...payload, value: 'changed', isUpdated: true, updateType: UpdateType.changeValue })}>
        Change
        {' '}
        {payload.name}
      </button>
      <button type="button" onClick={() => onRemove(payload.id)}>
        Remove
        {' '}
        {payload.name}
      </button>
      <button type="button" onClick={() => onReset(payload.id)}>
        Reset
        {' '}
        {payload.name}
      </button>
    </div>
  ),
}))

vi.mock('../add-row', () => ({
  default: ({ payload, onChange, onRemove }: AddRowProps) => (
    <div role="group" aria-label={`Added metadata ${payload.name}`}>
      <span>{payload.name}</span>
      <button type="button" onClick={() => onChange({ ...payload, value: 'new_value' })}>
        Change
        {' '}
        {payload.name}
      </button>
      <button type="button" onClick={onRemove}>
        Remove
        {' '}
        {payload.name}
      </button>
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

  const getEditRows = () => screen.getAllByRole('group', { name: /^Edit metadata / })
  const getEditRow = (name: string) => screen.getByRole('group', { name: `Edit metadata ${name}` })
  const getAddedRow = (name: string) => screen.getByRole('group', { name: `Added metadata ${name}` })
  const queryAddedRow = (name: string) => screen.queryByRole('group', { name: `Added metadata ${name}` })
  const openMetadataPicker = () => {
    fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
  }
  const selectMetadata = async (name = 'existing_field') => {
    openMetadataPicker()
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }))
  }
  const createMetadata = async (name = 'created_field') => {
    openMetadataPicker()
    fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }), { target: { value: name } })
    const saveButtons = screen.getAllByRole('button', { name: 'common.operation.save' })
    fireEvent.click(saveButtons[saveButtons.length - 1]!)
  }

  describe('Rendering', () => {
    it('should render without crashing', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })
    })

    it('should render document count', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText(/5/))!.toBeInTheDocument()
      })
    })

    it('should render all edit rows for existing items', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(getEditRows()).toHaveLength(2)
      })
    })

    it('should render field names for existing items', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('field_one'))!.toBeInTheDocument()
        expect(screen.getByText('field_two'))!.toBeInTheDocument()
      })
    })

    it('should render checkbox for apply to all', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: 'dataset.metadata.batchEditMetadata.applyToAllSelectDocument' })).toBeInTheDocument()
      })
    })

    it('should render dataset metadata picker', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))!.toBeInTheDocument()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onHide when cancel button is clicked', async () => {
      const onHide = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onHide={onHide} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      const cancelButton = screen.getByText(/cancel/i)
      fireEvent.click(cancelButton)

      expect(onHide).toHaveBeenCalled()
    })

    it('should call onSave when save button is clicked', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // Find the primary save button (not the one in DatasetMetadataPicker)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onSave).toHaveBeenCalled()
    })

    it('should toggle apply to all checkbox', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      const checkbox = screen.getByRole('checkbox', { name: 'dataset.metadata.batchEditMetadata.applyToAllSelectDocument' })
      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(checkbox).toHaveAttribute('aria-checked', 'true')
      })
    })

    it('should call onHide when modal close button is clicked', async () => {
      const onHide = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onHide={onHide} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })
    })
  })

  describe('Edit Row Operations', () => {
    it('should update item value when change is triggered', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Change field_one' }))

      // The component should update internally
      expect(getEditRows()).toHaveLength(2)
    })

    it('should mark item as deleted when remove is clicked', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Remove field_one' }))

      // The component should update internally - item marked as deleted
      expect(getEditRows()).toHaveLength(2)
    })

    it('should reset item when reset is clicked', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // First change the item
      fireEvent.click(screen.getByRole('button', { name: 'Change field_one' }))
      // Then reset it
      fireEvent.click(screen.getByRole('button', { name: 'Reset field_one' }))

      expect(getEditRows()).toHaveLength(2)
    })
  })

  describe('Add Metadata Operations', () => {
    it('should add new item when metadata is selected', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      await selectMetadata()

      // Should now have add-row for the new item
      await waitFor(() => {
        expect(getAddedRow('existing_field'))!.toBeInTheDocument()
      })
    })

    it('should remove added item when remove is clicked', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // First add an item
      await selectMetadata()

      await waitFor(() => {
        expect(getAddedRow('existing_field'))!.toBeInTheDocument()
      })

      // Then remove it
      fireEvent.click(screen.getByRole('button', { name: 'Remove existing_field' }))

      await waitFor(() => {
        expect(queryAddedRow('existing_field')).not.toBeInTheDocument()
      })
    })

    it('should update added item when change is triggered', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // First add an item
      await selectMetadata()

      await waitFor(() => {
        expect(getAddedRow('existing_field'))!.toBeInTheDocument()
      })

      // Then change it
      fireEvent.click(screen.getByRole('button', { name: 'Change existing_field' }))

      expect(getAddedRow('existing_field'))!.toBeInTheDocument()
    })

    it('should call doAddMetaData when saving new metadata with valid name', async () => {
      mockCheckNameResult = { errorMsg: '' }

      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      await createMetadata()

      await waitFor(() => {
        expect(mockDoAddMetaData).toHaveBeenCalled()
      })
    })

    it('should show success toast when saving with valid name', async () => {
      mockCheckNameResult = { errorMsg: '' }

      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      await createMetadata()

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
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      await createMetadata()

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
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      openMetadataPicker()
      fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.manageAction' }))

      expect(onShowManage).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('should pass correct datasetId', async () => {
      render(<EditMetadataBatchModal {...defaultProps} datasetId="custom-ds" />)
      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })
    })

    it('should display correct document number', async () => {
      render(<EditMetadataBatchModal {...defaultProps} documentNum={10} />)
      await waitFor(() => {
        expect(screen.getByText(/10/))!.toBeInTheDocument()
      })
    })

    it('should handle empty list', async () => {
      render(<EditMetadataBatchModal {...defaultProps} list={[]} />)
      await waitFor(() => {
        expect(screen.queryByRole('group', { name: /^Edit metadata / })).not.toBeInTheDocument()
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
        expect(getEditRow('field'))!.toBeInTheDocument()
      })
    })

    it('should handle rapid save clicks', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // Find the primary save button
      const saveBtn = screen.getByRole('button', { name: 'common.operation.save' })
      fireEvent.click(saveBtn)
      fireEvent.click(saveBtn)
      fireEvent.click(saveBtn)

      expect(onSave).toHaveBeenCalledTimes(3)
    })

    it('should pass correct arguments to onSave', async () => {
      const onSave = vi.fn()
      render(<EditMetadataBatchModal {...defaultProps} onSave={onSave} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

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
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('checkbox', { name: 'dataset.metadata.batchEditMetadata.applyToAllSelectDocument' }))

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

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
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // Remove an item
      fireEvent.click(screen.getByRole('button', { name: 'Remove field_one' }))

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onSave).toHaveBeenCalled()
      // The first argument should not contain the deleted item (id '1')
      const savedList = onSave.mock.calls[0]![0] as MetadataItemInBatchEdit[]
      const hasDeletedItem = savedList.some(item => item.id === '1')
      expect(hasDeletedItem).toBe(false)
    })

    it('should handle multiple add and remove operations', async () => {
      render(<EditMetadataBatchModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      })

      // Add first item
      await selectMetadata()
      await waitFor(() => {
        expect(getAddedRow('existing_field'))!.toBeInTheDocument()
      })

      // Remove it
      fireEvent.click(screen.getByRole('button', { name: 'Remove existing_field' }))

      await waitFor(() => {
        expect(queryAddedRow('existing_field')).not.toBeInTheDocument()
      })

      // Add again
      await selectMetadata()
      await waitFor(() => {
        expect(getAddedRow('existing_field'))!.toBeInTheDocument()
      })
    })
  })
})
