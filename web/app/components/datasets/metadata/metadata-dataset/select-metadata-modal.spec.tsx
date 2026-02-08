import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import SelectMetadataModal from './select-metadata-modal'

type MetadataItem = {
  id: string
  name: string
  type: DataType
}

type PortalProps = {
  children: React.ReactNode
  open: boolean
}

type TriggerProps = {
  children: React.ReactNode
  onClick: () => void
}

type ContentProps = {
  children: React.ReactNode
}

type SelectMetadataProps = {
  onSelect: (item: MetadataItem) => void
  onNew: () => void
  onManage: () => void
  list: MetadataItem[]
}

type CreateContentProps = {
  onSave: (data: { type: DataType, name: string }) => void
  onBack?: () => void
  onClose?: () => void
  hasBack?: boolean
}

// Mock useDatasetMetaData hook
vi.mock('@/service/knowledge/use-metadata', () => ({
  useDatasetMetaData: () => ({
    data: {
      doc_metadata: [
        { id: '1', name: 'field_one', type: DataType.string },
        { id: '2', name: 'field_two', type: DataType.number },
      ],
    },
  }),
}))

// Mock PortalToFollowElem components
vi.mock('../../../base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: PortalProps) => (
    <div data-testid="portal-wrapper" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: TriggerProps) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: ContentProps) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

// Mock SelectMetadata component
vi.mock('./select-metadata', () => ({
  default: ({ onSelect, onNew, onManage, list }: SelectMetadataProps) => (
    <div data-testid="select-metadata">
      <span data-testid="list-count">{list?.length || 0}</span>
      <button data-testid="select-item" onClick={() => onSelect({ id: '1', name: 'field_one', type: DataType.string })}>Select</button>
      <button data-testid="new-btn" onClick={onNew}>New</button>
      <button data-testid="manage-btn" onClick={onManage}>Manage</button>
    </div>
  ),
}))

// Mock CreateContent component
vi.mock('./create-content', () => ({
  default: ({ onSave, onBack, onClose, hasBack }: CreateContentProps) => (
    <div data-testid="create-content">
      <button data-testid="save-btn" onClick={() => onSave({ type: DataType.string, name: 'new_field' })}>Save</button>
      {hasBack && <button data-testid="back-btn" onClick={onBack}>Back</button>}
      <button data-testid="close-btn" onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('SelectMetadataModal', () => {
  const mockTrigger = <button data-testid="trigger-button">Select Metadata</button>

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })

    it('should render trigger element', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByTestId('trigger-button')).toBeInTheDocument()
    })

    it('should render SelectMetadata by default', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByTestId('select-metadata')).toBeInTheDocument()
    })

    it('should pass dataset metadata to SelectMetadata', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByTestId('list-count')).toHaveTextContent('2')
    })
  })

  describe('User Interactions', () => {
    it('should toggle open state when trigger is clicked', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByTestId('portal-trigger'))

      // State should toggle
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })

    it('should call onSelect and close when item is selected', () => {
      const handleSelect = vi.fn()
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={handleSelect}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByTestId('select-item'))

      expect(handleSelect).toHaveBeenCalledWith({
        id: '1',
        name: 'field_one',
        type: DataType.string,
      })
    })

    it('should switch to create step when new button is clicked', async () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByTestId('new-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('create-content')).toBeInTheDocument()
      })
    })

    it('should call onManage when manage button is clicked', () => {
      const handleManage = vi.fn()
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={handleManage}
        />,
      )

      fireEvent.click(screen.getByTestId('manage-btn'))

      expect(handleManage).toHaveBeenCalled()
    })
  })

  describe('Create Flow', () => {
    it('should switch back to select when back is clicked in create step', async () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      // Go to create step
      fireEvent.click(screen.getByTestId('new-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('create-content')).toBeInTheDocument()
      })

      // Go back to select step
      fireEvent.click(screen.getByTestId('back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-metadata')).toBeInTheDocument()
      })
    })

    it('should call onSave and return to select step when save is clicked', async () => {
      const handleSave = vi.fn().mockResolvedValue(undefined)
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={handleSave}
          onManage={vi.fn()}
        />,
      )

      // Go to create step
      fireEvent.click(screen.getByTestId('new-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('create-content')).toBeInTheDocument()
      })

      // Save new metadata
      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(handleSave).toHaveBeenCalledWith({
          type: DataType.string,
          name: 'new_field',
        })
      })
    })
  })

  describe('Props', () => {
    it('should accept custom popupPlacement', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
          popupPlacement="bottom-start"
        />,
      )
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })

    it('should accept custom popupOffset', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
          popupOffset={{ mainAxis: 10, crossAxis: 5 }}
        />,
      )
      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle different datasetIds', () => {
      const { rerender } = render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()

      rerender(
        <SelectMetadataModal
          datasetId="dataset-2"
          trigger={mockTrigger}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      expect(screen.getByTestId('portal-wrapper')).toBeInTheDocument()
    })

    it('should handle empty trigger', () => {
      render(
        <SelectMetadataModal
          datasetId="dataset-1"
          trigger={<span data-testid="empty-trigger" />}
          onSelect={vi.fn()}
          onSave={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByTestId('empty-trigger')).toBeInTheDocument()
    })
  })
})
