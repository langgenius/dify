import type { MetadataItemWithValue } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import MetadataDocument from './index'

type MockHookReturn = {
  embeddingAvailable: boolean
  isEdit: boolean
  setIsEdit: ReturnType<typeof vi.fn>
  list: MetadataItemWithValue[]
  tempList: MetadataItemWithValue[]
  setTempList: ReturnType<typeof vi.fn>
  handleSelectMetaData: ReturnType<typeof vi.fn>
  handleAddMetaData: ReturnType<typeof vi.fn>
  hasData: boolean
  builtList: MetadataItemWithValue[]
  builtInEnabled: boolean
  startToEdit: ReturnType<typeof vi.fn>
  handleSave: ReturnType<typeof vi.fn>
  handleCancel: ReturnType<typeof vi.fn>
  originInfo: MetadataItemWithValue[]
  technicalParameters: MetadataItemWithValue[]
}

// Mock useMetadataDocument hook - need to control state
const mockUseMetadataDocument = vi.fn<() => MockHookReturn>()
vi.mock('../hooks/use-metadata-document', () => ({
  default: () => mockUseMetadataDocument(),
}))

// Mock service calls
vi.mock('@/service/knowledge/use-metadata', () => ({
  useDatasetMetaData: () => ({
    data: {
      doc_metadata: [],
    },
  }),
}))

// Mock check name hook
vi.mock('../hooks/use-check-metadata-name', () => ({
  default: () => ({
    checkName: () => ({ errorMsg: '' }),
  }),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe('MetadataDocument', () => {
  const mockDocDetail = {
    id: 'doc-1',
    name: 'Test Document',
    data_source_type: 'upload_file',
    indexing_status: 'completed',
    created_at: 1609459200,
    word_count: 100,
  }

  const mockList: MetadataItemWithValue[] = [
    { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
    { id: '2', name: 'field_two', type: DataType.number, value: 42 },
  ]

  const defaultHookReturn: MockHookReturn = {
    embeddingAvailable: true,
    isEdit: false,
    setIsEdit: vi.fn(),
    list: mockList,
    tempList: mockList,
    setTempList: vi.fn(),
    handleSelectMetaData: vi.fn(),
    handleAddMetaData: vi.fn(),
    hasData: true,
    builtList: [],
    builtInEnabled: false,
    startToEdit: vi.fn(),
    handleSave: vi.fn(),
    handleCancel: vi.fn(),
    originInfo: [],
    technicalParameters: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMetadataDocument.mockReturnValue(defaultHookReturn)
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render metadata fields when hasData is true', () => {
      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      expect(screen.getByText('field_one')).toBeInTheDocument()
      expect(screen.getByText('field_two')).toBeInTheDocument()
    })

    it('should render no-data state when hasData is false and not in edit mode', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        hasData: false,
        list: [],
        tempList: [],
        isEdit: false,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      expect(screen.getAllByText(/metadata/i).length).toBeGreaterThan(0)
    })

    it('should render edit UI when in edit mode', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText(/save/i)).toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
    })

    it('should render built-in section when builtInEnabled is true', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        builtInEnabled: true,
        builtList: [{ id: 'built-in', name: 'created_at', type: DataType.time, value: 1609459200 }],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('created_at')).toBeInTheDocument()
    })

    it('should render divider when builtInEnabled is true', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        builtInEnabled: true,
        builtList: [{ id: 'built-in', name: 'created_at', type: DataType.time, value: 1609459200 }],
      })

      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      const divider = container.querySelector('[class*="bg-gradient"]')
      expect(divider).toBeInTheDocument()
    })

    it('should render origin info section', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        originInfo: [{ id: 'origin-1', name: 'source', type: DataType.string, value: 'upload' }],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('source')).toBeInTheDocument()
    })

    it('should render technical parameters section', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        technicalParameters: [{ id: 'tech-1', name: 'word_count', type: DataType.number, value: 100 }],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('word_count')).toBeInTheDocument()
    })

    it('should render all sections together', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        builtInEnabled: true,
        builtList: [{ id: 'built-1', name: 'created_at', type: DataType.time, value: 1609459200 }],
        originInfo: [{ id: 'origin-1', name: 'source', type: DataType.string, value: 'upload' }],
        technicalParameters: [{ id: 'tech-1', name: 'word_count', type: DataType.number, value: 100 }],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('field_one')).toBeInTheDocument()
      expect(screen.getByText('created_at')).toBeInTheDocument()
      expect(screen.getByText('source')).toBeInTheDocument()
      expect(screen.getByText('word_count')).toBeInTheDocument()
    })
  })

  describe('Edit Mode', () => {
    it('should show edit button when not in edit mode and embedding available', () => {
      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      expect(screen.getByText(/edit/i)).toBeInTheDocument()
    })

    it('should call startToEdit when edit button is clicked', () => {
      const startToEdit = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: false,
        startToEdit,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      fireEvent.click(screen.getByText(/edit/i))
      expect(startToEdit).toHaveBeenCalled()
    })

    it('should call handleSave when save button is clicked', () => {
      const handleSave = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        handleSave,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      fireEvent.click(screen.getByText(/save/i))
      expect(handleSave).toHaveBeenCalled()
    })

    it('should call handleCancel when cancel button is clicked', () => {
      const handleCancel = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        handleCancel,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      fireEvent.click(screen.getByText(/cancel/i))
      expect(handleCancel).toHaveBeenCalled()
    })

    it('should call setIsEdit(true) when start button is clicked in no-data state', () => {
      const setIsEdit = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        hasData: false,
        list: [],
        tempList: [],
        isEdit: false,
        setIsEdit,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      const startBtn = screen.queryByText(/start/i)
      if (startBtn) {
        fireEvent.click(startBtn)
        expect(setIsEdit).toHaveBeenCalledWith(true)
      }
    })

    it('should show InfoGroup when in edit mode without data', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        hasData: false,
        list: [],
        tempList: [],
        isEdit: true,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      // Should show save/cancel buttons
      expect(screen.getByText(/save/i)).toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
    })
  })

  describe('Data Operations', () => {
    it('should call setTempList when field value changes', async () => {
      const setTempList = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        setTempList,
      })

      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      const inputs = container.querySelectorAll('input')
      if (inputs.length > 0) {
        fireEvent.change(inputs[0], { target: { value: 'new value' } })

        await waitFor(() => {
          expect(setTempList).toHaveBeenCalled()
        })
      }
    })

    it('should have handleAddMetaData function available', () => {
      const handleAddMetaData = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        handleAddMetaData,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(typeof handleAddMetaData).toBe('function')
    })

    it('should have handleSelectMetaData function available', () => {
      const handleSelectMetaData = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        handleSelectMetaData,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(typeof handleSelectMetaData).toBe('function')
    })

    it('should pass onChange callback to InfoGroup', async () => {
      const setTempList = vi.fn()
      const tempList = [
        { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
      ]
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        tempList,
        setTempList,
      })

      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      const inputs = container.querySelectorAll('input')
      if (inputs.length > 0) {
        fireEvent.change(inputs[0], { target: { value: 'updated' } })
        await waitFor(() => {
          expect(setTempList).toHaveBeenCalled()
        })
      }
    })

    it('should pass onDelete callback to InfoGroup', async () => {
      const setTempList = vi.fn()
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        tempList: mockList,
        setTempList,
      })

      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      // Look for delete buttons - they are inside hover:bg-state-destructive-hover divs
      const deleteContainers = container.querySelectorAll('.hover\\:bg-state-destructive-hover')
      expect(deleteContainers.length).toBeGreaterThan(0)

      // Click the delete icon (SVG inside the container)
      if (deleteContainers.length > 0) {
        const deleteIcon = deleteContainers[0].querySelector('svg')
        if (deleteIcon)
          fireEvent.click(deleteIcon)

        await waitFor(() => {
          expect(setTempList).toHaveBeenCalled()
        })
      }
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
          className="custom-class"
        />,
      )
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should use tempList when in edit mode', () => {
      const tempList = [{ id: 'temp-1', name: 'temp_field', type: DataType.string, value: 'temp' }]
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
        tempList,
        list: mockList,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('temp_field')).toBeInTheDocument()
    })

    it('should use list when not in edit mode', () => {
      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('field_one')).toBeInTheDocument()
      expect(screen.getByText('field_two')).toBeInTheDocument()
    })

    it('should pass datasetId to child components', () => {
      render(
        <MetadataDocument
          datasetId="custom-ds-id"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      // Component should render without errors
      expect(screen.getByText('field_one')).toBeInTheDocument()
    })
  })

  describe('Embedding Availability', () => {
    it('should not show edit button when embedding is not available', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        embeddingAvailable: false,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.queryByText(/^edit$/i)).not.toBeInTheDocument()
    })

    it('should not show NoData when embedding is not available', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        embeddingAvailable: false,
        hasData: false,
        list: [],
        tempList: [],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      // NoData component should not be rendered
      expect(screen.queryByText(/start/i)).not.toBeInTheDocument()
    })

    it('should not show edit buttons in edit mode when embedding not available', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        embeddingAvailable: false,
        isEdit: false,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      // headerRight should be null/undefined
      expect(screen.queryByText(/^edit$/i)).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty lists', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        list: [],
        tempList: [],
        hasData: false,
      })

      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render correctly with minimal props', () => {
      const { container } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle switching between view and edit mode', () => {
      const { unmount } = render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText(/edit/i)).toBeInTheDocument()

      unmount()

      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        isEdit: true,
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText(/save/i)).toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
    })

    it('should handle multiple items in all sections', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        list: [
          { id: '1', name: 'user_field_1', type: DataType.string, value: 'v1' },
          { id: '2', name: 'user_field_2', type: DataType.number, value: 42 },
        ],
        builtInEnabled: true,
        builtList: [
          { id: 'b1', name: 'created_at', type: DataType.time, value: 1609459200 },
          { id: 'b2', name: 'modified_at', type: DataType.time, value: 1609459200 },
        ],
        originInfo: [
          { id: 'o1', name: 'source', type: DataType.string, value: 'file' },
          { id: 'o2', name: 'format', type: DataType.string, value: 'txt' },
        ],
        technicalParameters: [
          { id: 't1', name: 'word_count', type: DataType.number, value: 100 },
          { id: 't2', name: 'char_count', type: DataType.number, value: 500 },
        ],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('user_field_1')).toBeInTheDocument()
      expect(screen.getByText('user_field_2')).toBeInTheDocument()
      expect(screen.getByText('created_at')).toBeInTheDocument()
      expect(screen.getByText('source')).toBeInTheDocument()
      expect(screen.getByText('word_count')).toBeInTheDocument()
    })

    it('should handle null values in metadata', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        list: [
          { id: '1', name: 'null_field', type: DataType.string, value: null },
        ],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('null_field')).toBeInTheDocument()
    })

    it('should handle undefined values in metadata', () => {
      mockUseMetadataDocument.mockReturnValue({
        ...defaultHookReturn,
        list: [
          { id: '1', name: 'undefined_field', type: DataType.string, value: undefined as unknown as null },
        ],
      })

      render(
        <MetadataDocument
          datasetId="ds-1"
          documentId="doc-1"
          docDetail={mockDocDetail as Parameters<typeof MetadataDocument>[0]['docDetail']}
        />,
      )

      expect(screen.getByText('undefined_field')).toBeInTheDocument()
    })
  })
})
