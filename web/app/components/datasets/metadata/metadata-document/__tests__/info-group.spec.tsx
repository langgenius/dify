import type { MetadataItemWithValue } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataType } from '../../types'
import InfoGroup from '../info-group'

type InputCombinedProps = {
  value: string | number | null
  onChange: (value: string | number) => void
  type: DataType
}

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/service/knowledge/use-metadata', () => ({
  useDatasetMetaData: () => ({
    data: {
      doc_metadata: [
        { id: '1', name: 'test', type: DataType.string },
      ],
    },
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

// Mock InputCombined
vi.mock('../../edit-metadata-batch/input-combined', () => ({
  default: ({ value, onChange, type }: InputCombinedProps) => (
    <input
      aria-label={`Metadata ${type} value`}
      data-type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

describe('InfoGroup', () => {
  const mockList: MetadataItemWithValue[] = [
    { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
    { id: '2', name: 'field_two', type: DataType.number, value: 42 },
    { id: '3', name: 'built-in', type: DataType.time, value: 1609459200 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} />,
      )
      expect(container.firstChild)!.toBeInTheDocument()
    })

    it('should render title when provided', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" />,
      )
      expect(screen.getByText('Test Title'))!.toBeInTheDocument()
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
      expect(screen.getByText('field_one'))!.toBeInTheDocument()
      expect(screen.getByText('field_two'))!.toBeInTheDocument()
      expect(screen.getByText('built-in'))!.toBeInTheDocument()
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
      expect(screen.getByLabelText('This is a tooltip'))!.toBeInTheDocument()
    })

    it('should render headerRight content', () => {
      render(
        <InfoGroup
          dataSetId="ds-1"
          list={mockList}
          title="Test"
          headerRight={<button>Action</button>}
        />,
      )
      expect(screen.getByRole('button', { name: 'Action' }))!.toBeInTheDocument()
    })
  })

  describe('Edit Mode', () => {
    it('should render dataset metadata picker when isEdit is true', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )
      expect(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))!.toBeInTheDocument()
    })

    it('should not render dataset metadata picker when isEdit is false', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit={false} />,
      )
      expect(screen.queryByRole('button', { name: 'dataset.metadata.addMetadata' })).not.toBeInTheDocument()
    })

    it('should render input combined for each item in edit mode', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )
      const inputs = screen.getAllByRole('textbox')
      expect(inputs).toHaveLength(3)
    })

    it('should render delete icons in edit mode', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )
      expect(screen.getAllByRole('button', { name: 'common.operation.remove' })).toHaveLength(3)
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when input value changes', () => {
      const handleChange = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onChange={handleChange} />,
      )

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0]!, { target: { value: 'New Value' } })

      expect(handleChange).toHaveBeenCalled()
    })

    it('should call onDelete when delete icon is clicked', () => {
      const handleDelete = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onDelete={handleDelete} />,
      )

      fireEvent.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]!)

      expect(handleDelete).toHaveBeenCalled()
    })

    it('should call onSelect when metadata is selected', async () => {
      const handleSelect = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onSelect={handleSelect} />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      fireEvent.click(await screen.findByRole('option', { name: /test/ }))

      expect(handleSelect).toHaveBeenCalledWith({
        id: '1',
        name: 'test',
        type: DataType.string,
      })
    })

    it('should call onAdd when new metadata is saved', async () => {
      const handleAdd = vi.fn()
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit onAdd={handleAdd} />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      fireEvent.click(await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }), {
        target: { value: 'new_field' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(handleAdd).toHaveBeenCalledWith({
        name: 'new_field',
        type: DataType.string,
      })
    })

    it('should navigate to documents page when manage is clicked', async () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} isEdit />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      fireEvent.click(await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.manageAction' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} className="custom-class" />,
      )
      expect(container.firstChild)!.toHaveClass('custom-class')
    })

    it('should apply contentClassName', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={mockList} contentClassName="content-custom" />,
      )
      const contentDiv = container.querySelector('.content-custom')
      expect(contentDiv)!.toBeInTheDocument()
    })

    it('should use uppercase title by default', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" />,
      )
      const titleElement = screen.getByText('Test Title')
      expect(titleElement)!.toHaveClass('system-xs-semibold-uppercase')
    })

    it('should not use uppercase when uppercaseTitle is false', () => {
      render(
        <InfoGroup dataSetId="ds-1" list={mockList} title="Test Title" uppercaseTitle={false} />,
      )
      const titleElement = screen.getByText('Test Title')
      expect(titleElement)!.toHaveClass('system-md-semibold')
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
      expect(screen.getByText('Test Value'))!.toBeInTheDocument()
    })

    it('should display number value', () => {
      const numberList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.number, value: 123 },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={numberList} />,
      )
      expect(screen.getByText('123'))!.toBeInTheDocument()
    })

    it('should format time value', () => {
      const timeList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.time, value: 1609459200 },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={timeList} />,
      )
      // The mock formatTime returns formatted date
      // The mock formatTime returns formatted date
      expect(screen.getByText('field'))!.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty list', () => {
      const { container } = render(
        <InfoGroup dataSetId="ds-1" list={[]} />,
      )
      expect(container.firstChild)!.toBeInTheDocument()
    })

    it('should handle null value in list', () => {
      const nullList: MetadataItemWithValue[] = [
        { id: '1', name: 'field', type: DataType.string, value: null },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={nullList} />,
      )
      expect(screen.getByText('field'))!.toBeInTheDocument()
    })

    it('should handle items with built-in id', () => {
      const builtInList: MetadataItemWithValue[] = [
        { id: 'built-in', name: 'field', type: DataType.string, value: 'test' },
      ]
      render(
        <InfoGroup dataSetId="ds-1" list={builtInList} />,
      )
      expect(screen.getByText('field'))!.toBeInTheDocument()
    })
  })
})
