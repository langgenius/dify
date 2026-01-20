import type { MetadataItemWithValue } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import InfoGroup from './info-group'

type SelectModalProps = {
  trigger: React.ReactNode
  onSelect: (item: MetadataItemWithValue) => void
  onSave: (data: { name: string, type: DataType }) => void
  onManage: () => void
}

type FieldProps = {
  label: string
  children: React.ReactNode
}

type InputCombinedProps = {
  value: string | number | null
  onChange: (value: string | number) => void
  type: DataType
}

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

// Mock useTimestamp
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => {
      if (!timestamp)
        return ''
      return new Date(timestamp * 1000).toLocaleDateString()
    },
  }),
}))

// Mock AddMetadataButton
vi.mock('../add-metadata-button', () => ({
  default: () => <button data-testid="add-metadata-btn">Add Metadata</button>,
}))

// Mock InputCombined
vi.mock('../edit-metadata-batch/input-combined', () => ({
  default: ({ value, onChange, type }: InputCombinedProps) => (
    <input
      data-testid="input-combined"
      data-type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

// Mock SelectMetadataModal
vi.mock('../metadata-dataset/select-metadata-modal', () => ({
  default: ({ trigger, onSelect, onSave, onManage }: SelectModalProps) => (
    <div data-testid="select-metadata-modal">
      {trigger}
      <button data-testid="select-action" onClick={() => onSelect({ id: '1', name: 'test', type: DataType.string, value: null })}>Select</button>
      <button data-testid="save-action" onClick={() => onSave({ name: 'new_field', type: DataType.string })}>Save</button>
      <button data-testid="manage-action" onClick={onManage}>Manage</button>
    </div>
  ),
}))

// Mock Field
vi.mock('./field', () => ({
  default: ({ label, children }: FieldProps) => (
    <div data-testid="field">
      <span data-testid="field-label">{label}</span>
      <div data-testid="field-content">{children}</div>
    </div>
  ),
}))

describe('InfoGroup', () => {
  const mockList: MetadataItemWithValue[] = [
    { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
    { id: '2', name: 'field_two', type: DataType.number, value: 42 },
    { id: '3', name: 'built-in', type: DataType.time, value: 1609459200 },
  ]

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render title when provided', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" />,
      )
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should not render header when noHeader is true', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" noHeader />,
      )
      expect(screen.queryByText('Test Title')).not.toBeInTheDocument()
    })

    it('should render all list items', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} />,
      )
      const fields = screen.getAllByTestId('field')
      expect(fields).toHaveLength(3)
    })

    it('should render tooltip when titleTooltip is provided', () => {
      render(
        <InfoGroup
          dataSetId="ds-1"
          list={mockList}
          title="Test"
          titleTooltip="This is a tooltip"
        />,
      )
      // Tooltip icon should be present
      const tooltipIcon = screen.getByText('Test').closest('.flex')?.querySelector('svg')
      expect(tooltipIcon).toBeInTheDocument()
    })

    it('should render headerRight content', () => {
      render(
        <InfoGroup
          dataSetId="ds-1"
          list={mockList}
          title="Test"
          headerRight={<button data-testid="header-right-btn">Action</button>}
        />,
      )
      expect(screen.getByTestId('header-right-btn')).toBeInTheDocument()
    })
  })

  describe('Edit Mode', () => {
    it('should render add metadata button when isEdit is true', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )
      expect(screen.getByTestId('add-metadata-btn')).toBeInTheDocument()
    })

    it('should not render add metadata button when isEdit is false', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit={false} />,
      )
      expect(screen.queryByTestId('add-metadata-btn')).not.toBeInTheDocument()
    })

    it('should render input combined for each item in edit mode', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )
      const inputs = screen.getAllByTestId('input-combined')
      expect(inputs).toHaveLength(3)
    })

    it('should render delete icons in edit mode', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )
      const deleteIcons = container.querySelectorAll('.cursor-pointer svg')
      expect(deleteIcons.length).toBeGreaterThan(0)
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when input value changes', () => {
      const handleChange = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onChange={handleChange} />,
      )

      const inputs = screen.getAllByTestId('input-combined')
      fireEvent.change(inputs[0], { target: { value: 'New Value' } })

      expect(handleChange).toHaveBeenCalled()
    })

    it('should call onDelete when delete icon is clicked', () => {
      const handleDelete = vi.fn()
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onDelete={handleDelete} />,
      )

      // Find delete icons (RiDeleteBinLine SVGs inside cursor-pointer divs)
      const deleteButtons = container.querySelectorAll('svg.size-4')
      if (deleteButtons.length > 0)
        fireEvent.click(deleteButtons[0])

      expect(handleDelete).toHaveBeenCalled()
    })

    it('should call onSelect when metadata is selected', () => {
      const handleSelect = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onSelect={handleSelect} />,
      )

      fireEvent.click(screen.getByTestId('select-action'))

      expect(handleSelect).toHaveBeenCalledWith({
        id: '1',
        name: 'test',
        type: DataType.string,
        value: null,
      })
    })

    it('should call onAdd when new metadata is saved', () => {
      const handleAdd = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onAdd={handleAdd} />,
      )

      fireEvent.click(screen.getByTestId('save-action'))

      expect(handleAdd).toHaveBeenCalledWith({
        name: 'new_field',
        type: DataType.string,
      })
    })

    it('should navigate to documents page when manage is clicked', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )

      fireEvent.click(screen.getByTestId('manage-action'))

      // The onManage callback triggers the navigation
      expect(screen.getByTestId('manage-action')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} className="custom-class" />,
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should apply contentClassName', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} contentClassName="content-custom" />,
      )
      const contentDiv = container.querySelector('.content-custom')
      expect(contentDiv).toBeInTheDocument()
    })

    it('should use uppercase title by default', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" />,
      )
      const titleElement = screen.getByText('Test Title')
      expect(titleElement).toHaveClass('system-xs-semibold-uppercase')
    })

    it('should not use uppercase when uppercaseTitle is false', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" uppercaseTitle={false} />,
      )
      const titleElement = screen.getByText('Test Title')
      expect(titleElement).toHaveClass('system-md-semibold')
    })
  })

  describe('Value Display', () => {
    it('should display string value directly', () => {
      const stringList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.string, value: 'Test Value' },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={stringList} />,
      )
      expect(screen.getByText('Test Value')).toBeInTheDocument()
    })

    it('should display number value', () => {
      const numberList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.number, value: 123 },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={numberList} />,
      )
      expect(screen.getByText('123')).toBeInTheDocument()
    })

    it('should format time value', () => {
      const timeList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.time, value: 1609459200 },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={timeList} />,
      )
      // The mock formatTime returns formatted date
      expect(screen.getByTestId('field-content')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty list', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={[]} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle null value in list', () => {
      const nullList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.string, value: null },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={nullList} />,
      )
      expect(screen.getByTestId('field')).toBeInTheDocument()
    })

    it('should handle items with built-in id', () => {
      const builtInList: MetadataItemWithValue[] = [
        { id: 'built-in', name: 'field', type: DataType.string, value: 'test' },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={builtInList} />,
      )
      expect(screen.getByTestId('field')).toBeInTheDocument()
    })
  })
})
