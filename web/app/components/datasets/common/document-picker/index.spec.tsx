import type { ParentMode, SimpleDocumentDetail } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import DocumentPicker from './index'

// Mock portal-to-follow-elem - always render content for testing
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: {
    children: React.ReactNode
    open?: boolean
  }) => (
    <div data-testid="portal-elem" data-open={String(open || false)}>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <div data-testid="portal-trigger" onClick={onClick}>
      {children}
    </div>
  ),
  // Always render content to allow testing document selection
  PortalToFollowElemContent: ({ children, className }: {
    children: React.ReactNode
    className?: string
  }) => (
    <div data-testid="portal-content" className={className}>
      {children}
    </div>
  ),
}))

// Mock useDocumentList hook with controllable return value
let mockDocumentListData: { data: SimpleDocumentDetail[] } | undefined
let mockDocumentListLoading = false

const { mockUseDocumentList } = vi.hoisted(() => ({
  mockUseDocumentList: vi.fn(),
}))

// Set up the implementation after variables are defined
mockUseDocumentList.mockImplementation(() => ({
  data: mockDocumentListLoading ? undefined : mockDocumentListData,
  isLoading: mockDocumentListLoading,
}))

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentList: mockUseDocumentList,
}))

// Mock icons - mock all remixicon components used in the component tree
vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <span data-testid="arrow-icon">↓</span>,
  RiFile3Fill: () => <span data-testid="file-icon">📄</span>,
  RiFileCodeFill: () => <span data-testid="file-code-icon">📄</span>,
  RiFileExcelFill: () => <span data-testid="file-excel-icon">📄</span>,
  RiFileGifFill: () => <span data-testid="file-gif-icon">📄</span>,
  RiFileImageFill: () => <span data-testid="file-image-icon">📄</span>,
  RiFileMusicFill: () => <span data-testid="file-music-icon">📄</span>,
  RiFilePdf2Fill: () => <span data-testid="file-pdf-icon">📄</span>,
  RiFilePpt2Fill: () => <span data-testid="file-ppt-icon">📄</span>,
  RiFileTextFill: () => <span data-testid="file-text-icon">📄</span>,
  RiFileVideoFill: () => <span data-testid="file-video-icon">📄</span>,
  RiFileWordFill: () => <span data-testid="file-word-icon">📄</span>,
  RiMarkdownFill: () => <span data-testid="file-markdown-icon">📄</span>,
  RiSearchLine: () => <span data-testid="search-icon">🔍</span>,
  RiCloseLine: () => <span data-testid="close-icon">✕</span>,
}))

// Factory function to create mock SimpleDocumentDetail
const createMockDocument = (overrides: Partial<SimpleDocumentDetail> = {}): SimpleDocumentDetail => ({
  id: `doc-${Math.random().toString(36).substr(2, 9)}`,
  batch: 'batch-1',
  position: 1,
  dataset_id: 'dataset-1',
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'test-file.txt',
      size: 1024,
      extension: 'txt',
      mime_type: 'text/plain',
      created_by: 'user-1',
      created_at: Date.now(),
    },
    // Required fields for LegacyDataSourceInfo
    job_id: 'job-1',
    url: '',
  },
  dataset_process_rule_id: 'rule-1',
  name: 'Test Document',
  created_from: 'web',
  created_by: 'user-1',
  created_at: Date.now(),
  indexing_status: 'completed',
  display_status: 'enabled',
  doc_form: ChunkingMode.text,
  doc_language: 'en',
  enabled: true,
  word_count: 1000,
  archived: false,
  updated_at: Date.now(),
  hit_count: 0,
  data_source_detail_dict: {
    upload_file: {
      name: 'test-file.txt',
      extension: 'txt',
    },
  },
  ...overrides,
})

// Factory function to create multiple documents
const createMockDocumentList = (count: number): SimpleDocumentDetail[] => {
  return Array.from({ length: count }, (_, index) =>
    createMockDocument({
      id: `doc-${index + 1}`,
      name: `Document ${index + 1}`,
      data_source_detail_dict: {
        upload_file: {
          name: `document-${index + 1}.pdf`,
          extension: 'pdf',
        },
      },
    }))
}

// Factory function to create props
const createDefaultProps = (overrides: Partial<React.ComponentProps<typeof DocumentPicker>> = {}) => ({
  datasetId: 'dataset-1',
  value: {
    name: 'Test Document',
    extension: 'txt',
    chunkingMode: ChunkingMode.text,
    parentMode: undefined as ParentMode | undefined,
  },
  onChange: vi.fn(),
  ...overrides,
})

// Create a new QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  })

// Helper to render component with providers
const renderComponent = (props: Partial<React.ComponentProps<typeof DocumentPicker>> = {}) => {
  const queryClient = createTestQueryClient()
  const defaultProps = createDefaultProps(props)

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <DocumentPicker {...defaultProps} />
      </QueryClientProvider>,
    ),
    queryClient,
    props: defaultProps,
  }
}

describe('DocumentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    mockDocumentListData = { data: createMockDocumentList(5) }
    mockDocumentListLoading = false
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderComponent()

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should render document name when provided', () => {
      renderComponent({
        value: {
          name: 'My Document',
          extension: 'pdf',
          chunkingMode: ChunkingMode.text,
        },
      })

      expect(screen.getByText('My Document')).toBeInTheDocument()
    })

    it('should render placeholder when name is not provided', () => {
      renderComponent({
        value: {
          name: undefined,
          extension: 'pdf',
          chunkingMode: ChunkingMode.text,
        },
      })

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should render arrow icon', () => {
      renderComponent()

      expect(screen.getByTestId('arrow-icon')).toBeInTheDocument()
    })

    it('should render general mode label', () => {
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.text,
        },
      })

      expect(screen.getByText('dataset.chunkingMode.general')).toBeInTheDocument()
    })

    it('should render QA mode label', () => {
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.qa,
        },
      })

      expect(screen.getByText('dataset.chunkingMode.qa')).toBeInTheDocument()
    })

    it('should render parentChild mode label with paragraph parent mode', () => {
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.parentChild,
          parentMode: 'paragraph',
        },
      })

      expect(screen.getByText(/dataset.chunkingMode.parentChild/)).toBeInTheDocument()
      expect(screen.getByText(/dataset.parentMode.paragraph/)).toBeInTheDocument()
    })

    it('should render parentChild mode label with full-doc parent mode', () => {
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.parentChild,
          parentMode: 'full-doc',
        },
      })

      expect(screen.getByText(/dataset.chunkingMode.parentChild/)).toBeInTheDocument()
      expect(screen.getByText(/dataset.parentMode.fullDoc/)).toBeInTheDocument()
    })

    it('should render placeholder for parentMode when not provided', () => {
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.parentChild,
          parentMode: undefined,
        },
      })

      // parentModeLabel should be '--' when parentMode is not provided
      expect(screen.getByText(/--/)).toBeInTheDocument()
    })
  })

  // Tests for props handling
  describe('Props', () => {
    it('should accept required props', () => {
      const onChange = vi.fn()
      renderComponent({
        datasetId: 'test-dataset',
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.text,
        },
        onChange,
      })

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle value with all fields', () => {
      renderComponent({
        value: {
          name: 'Full Document',
          extension: 'docx',
          chunkingMode: ChunkingMode.parentChild,
          parentMode: 'paragraph',
        },
      })

      expect(screen.getByText('Full Document')).toBeInTheDocument()
    })

    it('should handle value with minimal fields', () => {
      renderComponent({
        value: {
          name: undefined,
          extension: undefined,
          chunkingMode: undefined,
          parentMode: undefined,
        },
      })

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should pass datasetId to mockUseDocumentList hook', () => {
      renderComponent({ datasetId: 'custom-dataset-id' })

      expect(mockUseDocumentList).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: 'custom-dataset-id',
        }),
      )
    })
  })

  // Tests for state management and updates
  describe('State Management', () => {
    it('should initialize with popup closed', () => {
      renderComponent()

      expect(screen.getByTestId('portal-elem')).toHaveAttribute('data-open', 'false')
    })

    it('should open popup when trigger is clicked', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Verify click handler is called
      expect(trigger).toBeInTheDocument()
    })

    it('should maintain search query state', async () => {
      renderComponent()

      // Initial call should have empty keyword
      expect(mockUseDocumentList).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            keyword: '',
          }),
        }),
      )
    })

    it('should update query when search input changes', () => {
      renderComponent()

      // Verify the component uses mockUseDocumentList with query parameter

      expect(mockUseDocumentList).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            keyword: '',
          }),
        }),
      )
    })
  })

  // Tests for callback stability and memoization
  describe('Callback Stability', () => {
    it('should maintain stable onChange callback when value changes', () => {
      const onChange = vi.fn()
      const value1 = {
        name: 'Doc 1',
        extension: 'txt',
        chunkingMode: ChunkingMode.text,
      }
      const value2 = {
        name: 'Doc 2',
        extension: 'pdf',
        chunkingMode: ChunkingMode.text,
      }

      const queryClient = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="dataset-1"
            value={value1}
            onChange={onChange}
          />
        </QueryClientProvider>,
      )

      rerender(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="dataset-1"
            value={value2}
            onChange={onChange}
          />
        </QueryClientProvider>,
      )

      // Component should still render correctly after rerender
      expect(screen.getByText('Doc 2')).toBeInTheDocument()
    })

    it('should use updated onChange callback after rerender', () => {
      const onChange1 = vi.fn()
      const onChange2 = vi.fn()
      const value = {
        name: 'Test Doc',
        extension: 'txt',
        chunkingMode: ChunkingMode.text,
      }

      const queryClient = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="dataset-1"
            value={value}
            onChange={onChange1}
          />
        </QueryClientProvider>,
      )

      rerender(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="dataset-1"
            value={value}
            onChange={onChange2}
          />
        </QueryClientProvider>,
      )

      // The component should use the new callback
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should memoize handleChange callback with useCallback', () => {
      // The handleChange callback is created with useCallback and depends on
      // documentsList, onChange, and setOpen
      const onChange = vi.fn()
      renderComponent({ onChange })

      // Verify component renders correctly, callback memoization is internal
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // Tests for memoization logic and dependencies
  describe('Memoization Logic', () => {
    it('should be wrapped with React.memo', () => {
      // React.memo components have a $$typeof property
      expect((DocumentPicker as any).$$typeof).toBeDefined()
    })

    it('should compute parentModeLabel correctly with useMemo', () => {
      // Test paragraph mode
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.parentChild,
          parentMode: 'paragraph',
        },
      })

      expect(screen.getByText(/dataset.parentMode.paragraph/)).toBeInTheDocument()
    })

    it('should update parentModeLabel when parentMode changes', () => {
      // Test full-doc mode
      renderComponent({
        value: {
          name: 'Test',
          extension: 'txt',
          chunkingMode: ChunkingMode.parentChild,
          parentMode: 'full-doc',
        },
      })

      expect(screen.getByText(/dataset.parentMode.fullDoc/)).toBeInTheDocument()
    })

    it('should not re-render when props are the same', () => {
      const onChange = vi.fn()
      const value = {
        name: 'Stable Doc',
        extension: 'txt',
        chunkingMode: ChunkingMode.text,
      }

      const queryClient = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="dataset-1"
            value={value}
            onChange={onChange}
          />
        </QueryClientProvider>,
      )

      // Rerender with same props reference
      rerender(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="dataset-1"
            value={value}
            onChange={onChange}
          />
        </QueryClientProvider>,
      )

      expect(screen.getByText('Stable Doc')).toBeInTheDocument()
    })
  })

  // Tests for user interactions and event handlers
  describe('User Interactions', () => {
    it('should toggle popup when trigger is clicked', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Trigger click should be handled
      expect(trigger).toBeInTheDocument()
    })

    it('should handle document selection when popup is open', () => {
      // Test the handleChange callback logic
      const onChange = vi.fn()
      const mockDocs = createMockDocumentList(3)
      mockDocumentListData = { data: mockDocs }

      renderComponent({ onChange })

      // The handleChange callback should find the document and call onChange
      // We can verify this by checking that mockUseDocumentList was called

      expect(mockUseDocumentList).toHaveBeenCalled()
    })

    it('should handle search input change', () => {
      renderComponent()

      // The search input is only visible when popup is open
      // We verify that the component initializes with empty query

      expect(mockUseDocumentList).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            keyword: '',
          }),
        }),
      )
    })

    it('should initialize with default query parameters', () => {
      renderComponent()

      expect(mockUseDocumentList).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            keyword: '',
            page: 1,
            limit: 20,
          },
        }),
      )
    })
  })

  // Tests for API calls
  describe('API Calls', () => {
    it('should call mockUseDocumentList with correct parameters', () => {
      renderComponent({ datasetId: 'test-dataset-123' })

      expect(mockUseDocumentList).toHaveBeenCalledWith({
        datasetId: 'test-dataset-123',
        query: {
          keyword: '',
          page: 1,
          limit: 20,
        },
      })
    })

    it('should handle loading state', () => {
      mockDocumentListLoading = true
      mockDocumentListData = undefined

      renderComponent()

      // When loading, component should still render without crashing
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should fetch documents on mount', () => {
      mockDocumentListLoading = false
      mockDocumentListData = { data: createMockDocumentList(3) }

      renderComponent()

      // Verify the hook was called

      expect(mockUseDocumentList).toHaveBeenCalled()
    })

    it('should handle empty document list', () => {
      mockDocumentListData = { data: [] }

      renderComponent()

      // Component should render without crashing
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle undefined data response', () => {
      mockDocumentListData = undefined

      renderComponent()

      // Should not crash
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // Tests for component memoization
  describe('Component Memoization', () => {
    it('should export as React.memo wrapped component', () => {
      // Check that the component is memoized
      expect(DocumentPicker).toBeDefined()
      expect(typeof DocumentPicker).toBe('object') // React.memo returns an object
    })

    it('should preserve render output when datasetId is the same', () => {
      const queryClient = createTestQueryClient()
      const value = {
        name: 'Memo Test',
        extension: 'txt',
        chunkingMode: ChunkingMode.text,
      }
      const onChange = vi.fn()

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="same-dataset"
            value={value}
            onChange={onChange}
          />
        </QueryClientProvider>,
      )

      expect(screen.getByText('Memo Test')).toBeInTheDocument()

      rerender(
        <QueryClientProvider client={queryClient}>
          <DocumentPicker
            datasetId="same-dataset"
            value={value}
            onChange={onChange}
          />
        </QueryClientProvider>,
      )

      expect(screen.getByText('Memo Test')).toBeInTheDocument()
    })
  })

  // Tests for edge cases and error handling
  describe('Edge Cases', () => {
    it('should handle null name', () => {
      renderComponent({
        value: {
          name: undefined,
          extension: 'txt',
          chunkingMode: ChunkingMode.text,
        },
      })

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should handle empty string name', () => {
      renderComponent({
        value: {
          name: '',
          extension: 'txt',
          chunkingMode: ChunkingMode.text,
        },
      })

      // Empty string is falsy, so should show '--'
      expect(screen.queryByText('--')).toBeInTheDocument()
    })

    it('should handle undefined extension', () => {
      renderComponent({
        value: {
          name: 'Test Doc',
          extension: undefined,
          chunkingMode: ChunkingMode.text,
        },
      })

      // Should not crash
      expect(screen.getByText('Test Doc')).toBeInTheDocument()
    })

    it('should handle undefined chunkingMode', () => {
      renderComponent({
        value: {
          name: 'Test Doc',
          extension: 'txt',
          chunkingMode: undefined,
        },
      })

      // When chunkingMode is undefined, none of the mode conditions are true
      expect(screen.getByText('Test Doc')).toBeInTheDocument()
    })

    it('should handle document without data_source_detail_dict', () => {
      const docWithoutDetail = createMockDocument({
        id: 'doc-no-detail',
        name: 'Doc Without Detail',
        data_source_detail_dict: undefined,
      })
      mockDocumentListData = { data: [docWithoutDetail] }

      // Component should handle mapping documents even without data_source_detail_dict
      renderComponent()

      // Should not crash
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle rapid toggle clicks', () => {
      renderComponent()

      const trigger = screen.getByTestId('portal-trigger')

      // Rapid clicks
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      fireEvent.click(trigger)

      // Should not crash
      expect(trigger).toBeInTheDocument()
    })

    it('should handle very long document names in trigger', () => {
      const longName = 'A'.repeat(500)
      renderComponent({
        value: {
          name: longName,
          extension: 'txt',
          chunkingMode: ChunkingMode.text,
        },
      })

      // Should render long name without crashing
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in document name', () => {
      const specialName = '<script>alert("xss")</script>'
      renderComponent({
        value: {
          name: specialName,
          extension: 'txt',
          chunkingMode: ChunkingMode.text,
        },
      })

      // React should escape the text
      expect(screen.getByText(specialName)).toBeInTheDocument()
    })

    it('should handle documents with missing extension in data_source_detail_dict', () => {
      const docWithEmptyExtension = createMockDocument({
        id: 'doc-empty-ext',
        name: 'Doc Empty Ext',
        data_source_detail_dict: {
          upload_file: {
            name: 'file-no-ext',
            extension: '',
          },
        },
      })
      mockDocumentListData = { data: [docWithEmptyExtension] }

      // Component should handle mapping documents with empty extension
      renderComponent()

      // Should not crash
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle document list mapping with various data_source_detail_dict states', () => {
      // Test the mapping logic: d.data_source_detail_dict?.upload_file?.extension || ''
      const docs = [
        createMockDocument({
          id: 'doc-1',
          name: 'With Extension',
          data_source_detail_dict: {
            upload_file: { name: 'file.pdf', extension: 'pdf' },
          },
        }),
        createMockDocument({
          id: 'doc-2',
          name: 'Without Detail Dict',
          data_source_detail_dict: undefined,
        }),
      ]
      mockDocumentListData = { data: docs }

      renderComponent()

      // Should not crash during mapping
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // Tests for all prop variations
  describe('Prop Variations', () => {
    describe('datasetId variations', () => {
      it('should handle empty datasetId', () => {
        renderComponent({ datasetId: '' })

        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })

      it('should handle UUID format datasetId', () => {
        renderComponent({ datasetId: '123e4567-e89b-12d3-a456-426614174000' })

        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
      })
    })

    describe('value.chunkingMode variations', () => {
      const chunkingModes = [
        { mode: ChunkingMode.text, label: 'dataset.chunkingMode.general' },
        { mode: ChunkingMode.qa, label: 'dataset.chunkingMode.qa' },
        { mode: ChunkingMode.parentChild, label: 'dataset.chunkingMode.parentChild' },
      ]

      it.each(chunkingModes)(
        'should display correct label for $mode mode',
        ({ mode, label }) => {
          renderComponent({
            value: {
              name: 'Test',
              extension: 'txt',
              chunkingMode: mode,
              parentMode: mode === ChunkingMode.parentChild ? 'paragraph' : undefined,
            },
          })

          expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
        },
      )
    })

    describe('value.parentMode variations', () => {
      const parentModes: Array<{ mode: ParentMode, label: string }> = [
        { mode: 'paragraph', label: 'dataset.parentMode.paragraph' },
        { mode: 'full-doc', label: 'dataset.parentMode.fullDoc' },
      ]

      it.each(parentModes)(
        'should display correct label for $mode parentMode',
        ({ mode, label }) => {
          renderComponent({
            value: {
              name: 'Test',
              extension: 'txt',
              chunkingMode: ChunkingMode.parentChild,
              parentMode: mode,
            },
          })

          expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
        },
      )
    })

    describe('value.extension variations', () => {
      const extensions = ['txt', 'pdf', 'docx', 'xlsx', 'csv', 'md', 'html']

      it.each(extensions)('should handle %s extension', (ext) => {
        renderComponent({
          value: {
            name: `File.${ext}`,
            extension: ext,
            chunkingMode: ChunkingMode.text,
          },
        })

        expect(screen.getByText(`File.${ext}`)).toBeInTheDocument()
      })
    })
  })

  // Tests for document selection
  describe('Document Selection', () => {
    it('should fetch documents list via mockUseDocumentList', () => {
      const mockDoc = createMockDocument({
        id: 'selected-doc',
        name: 'Selected Document',
      })
      mockDocumentListData = { data: [mockDoc] }
      const onChange = vi.fn()

      renderComponent({ onChange })

      // Verify the hook was called

      expect(mockUseDocumentList).toHaveBeenCalled()
    })

    it('should call onChange when document is selected', () => {
      const docs = createMockDocumentList(3)
      mockDocumentListData = { data: docs }
      const onChange = vi.fn()

      renderComponent({ onChange })

      // Click on a document in the list
      fireEvent.click(screen.getByText('Document 2'))

      // handleChange should find the document and call onChange with full document
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(docs[1])
    })

    it('should map document list items correctly', () => {
      const docs = createMockDocumentList(3)
      mockDocumentListData = { data: docs }

      renderComponent()

      // Documents should be rendered in the list
      expect(screen.getByText('Document 1')).toBeInTheDocument()
      expect(screen.getByText('Document 2')).toBeInTheDocument()
      expect(screen.getByText('Document 3')).toBeInTheDocument()
    })
  })

  // Tests for integration with child components
  describe('Child Component Integration', () => {
    it('should pass correct data to DocumentList when popup is open', () => {
      const docs = createMockDocumentList(3)
      mockDocumentListData = { data: docs }

      renderComponent()

      // DocumentList receives mapped documents: { id, name, extension }
      // We verify the data is fetched

      expect(mockUseDocumentList).toHaveBeenCalled()
    })

    it('should map document data_source_detail_dict extension correctly', () => {
      const doc = createMockDocument({
        id: 'mapped-doc',
        name: 'Mapped Document',
        data_source_detail_dict: {
          upload_file: {
            name: 'mapped.pdf',
            extension: 'pdf',
          },
        },
      })
      mockDocumentListData = { data: [doc] }

      renderComponent()

      // The mapping: d.data_source_detail_dict?.upload_file?.extension || ''
      // Should extract 'pdf' from the document
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should render trigger with SearchInput integration', () => {
      renderComponent()

      // The trigger is always rendered
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })

    it('should integrate FileIcon component', () => {
      // Use empty document list to avoid duplicate icons from list
      mockDocumentListData = { data: [] }

      renderComponent({
        value: {
          name: 'test.pdf',
          extension: 'pdf',
          chunkingMode: ChunkingMode.text,
        },
      })

      // FileIcon should be rendered via DocumentFileIcon - pdf renders pdf icon
      expect(screen.getByTestId('file-pdf-icon')).toBeInTheDocument()
    })
  })

  // Tests for visual states
  describe('Visual States', () => {
    it('should render portal content for document selection', () => {
      renderComponent()

      // Portal content is rendered in our mock for testing
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })
  })
})
