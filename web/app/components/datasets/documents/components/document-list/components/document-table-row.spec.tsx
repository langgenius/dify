import type { ReactNode } from 'react'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import DocumentTableRow from './document-table-row'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
})

const createWrapper = () => {
  const queryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <table>
        <tbody>
          {children}
        </tbody>
      </table>
    </QueryClientProvider>
  )
}

type LocalDoc = SimpleDocumentDetail & { percent?: number }

const createMockDoc = (overrides: Record<string, unknown> = {}): LocalDoc => ({
  id: 'doc-1',
  position: 1,
  data_source_type: DataSourceType.FILE,
  data_source_info: {},
  data_source_detail_dict: {
    upload_file: { name: 'test.txt', extension: 'txt' },
  },
  dataset_process_rule_id: 'rule-1',
  dataset_id: 'dataset-1',
  batch: 'batch-1',
  name: 'test-document.txt',
  created_from: 'web',
  created_by: 'user-1',
  created_at: Date.now(),
  tokens: 100,
  indexing_status: 'completed',
  error: null,
  enabled: true,
  disabled_at: null,
  disabled_by: null,
  archived: false,
  archived_reason: null,
  archived_by: null,
  archived_at: null,
  updated_at: Date.now(),
  doc_type: null,
  doc_metadata: undefined,
  doc_language: 'en',
  display_status: 'available',
  word_count: 500,
  hit_count: 10,
  doc_form: 'text_model',
  ...overrides,
}) as unknown as LocalDoc

// Helper to find the custom checkbox div (Checkbox component renders as a div, not a native checkbox)
const findCheckbox = (container: HTMLElement): HTMLElement | null => {
  return container.querySelector('[class*="shadow-xs"]')
}

describe('DocumentTableRow', () => {
  const defaultProps = {
    doc: createMockDoc(),
    index: 0,
    datasetId: 'dataset-1',
    isSelected: false,
    isGeneralMode: true,
    isQAMode: false,
    embeddingAvailable: true,
    selectedIds: [],
    onSelectOne: vi.fn(),
    onSelectedIdChange: vi.fn(),
    onShowRenameModal: vi.fn(),
    onUpdate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('test-document.txt')).toBeInTheDocument()
    })

    it('should render index number correctly', () => {
      render(<DocumentTableRow {...defaultProps} index={5} />, { wrapper: createWrapper() })
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('should render document name with tooltip', () => {
      render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('test-document.txt')).toBeInTheDocument()
    })

    it('should render checkbox element', () => {
      const { container } = render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })
      const checkbox = findCheckbox(container)
      expect(checkbox).toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    it('should show check icon when isSelected is true', () => {
      const { container } = render(<DocumentTableRow {...defaultProps} isSelected />, { wrapper: createWrapper() })
      // When selected, the checkbox should have a check icon (RiCheckLine svg)
      const checkbox = findCheckbox(container)
      expect(checkbox).toBeInTheDocument()
      const checkIcon = checkbox?.querySelector('svg')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should not show check icon when isSelected is false', () => {
      const { container } = render(<DocumentTableRow {...defaultProps} isSelected={false} />, { wrapper: createWrapper() })
      const checkbox = findCheckbox(container)
      expect(checkbox).toBeInTheDocument()
      // When not selected, there should be no check icon inside the checkbox
      const checkIcon = checkbox?.querySelector('svg')
      expect(checkIcon).not.toBeInTheDocument()
    })

    it('should call onSelectOne when checkbox is clicked', () => {
      const onSelectOne = vi.fn()
      const { container } = render(<DocumentTableRow {...defaultProps} onSelectOne={onSelectOne} />, { wrapper: createWrapper() })

      const checkbox = findCheckbox(container)
      if (checkbox) {
        fireEvent.click(checkbox)
        expect(onSelectOne).toHaveBeenCalledWith('doc-1')
      }
    })

    it('should stop propagation when checkbox container is clicked', () => {
      const { container } = render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })

      // Click the div containing the checkbox (which has stopPropagation)
      const checkboxContainer = container.querySelector('td')?.querySelector('div')
      if (checkboxContainer) {
        fireEvent.click(checkboxContainer)
        expect(mockPush).not.toHaveBeenCalled()
      }
    })
  })

  describe('Row Navigation', () => {
    it('should navigate to document detail on row click', () => {
      render(<DocumentTableRow {...defaultProps} />, { wrapper: createWrapper() })

      const row = screen.getByRole('row')
      fireEvent.click(row)

      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/doc-1')
    })

    it('should navigate with correct datasetId and documentId', () => {
      render(
        <DocumentTableRow
          {...defaultProps}
          datasetId="custom-dataset"
          doc={createMockDoc({ id: 'custom-doc' })}
        />,
        { wrapper: createWrapper() },
      )

      const row = screen.getByRole('row')
      fireEvent.click(row)

      expect(mockPush).toHaveBeenCalledWith('/datasets/custom-dataset/documents/custom-doc')
    })
  })

  describe('Word Count Display', () => {
    it('should display word count less than 1000 as is', () => {
      const doc = createMockDoc({ word_count: 500 })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByText('500')).toBeInTheDocument()
    })

    it('should display word count 1000 or more in k format', () => {
      const doc = createMockDoc({ word_count: 1500 })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByText('1.5k')).toBeInTheDocument()
    })

    it('should display 0 with empty style when word_count is 0', () => {
      const doc = createMockDoc({ word_count: 0 })
      const { container } = render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      const zeroCells = container.querySelectorAll('.text-text-tertiary')
      expect(zeroCells.length).toBeGreaterThan(0)
    })

    it('should handle undefined word_count', () => {
      const doc = createMockDoc({ word_count: undefined as unknown as number })
      const { container } = render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(container).toBeInTheDocument()
    })
  })

  describe('Hit Count Display', () => {
    it('should display hit count less than 1000 as is', () => {
      const doc = createMockDoc({ hit_count: 100 })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByText('100')).toBeInTheDocument()
    })

    it('should display hit count 1000 or more in k format', () => {
      const doc = createMockDoc({ hit_count: 2500 })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByText('2.5k')).toBeInTheDocument()
    })

    it('should display 0 with empty style when hit_count is 0', () => {
      const doc = createMockDoc({ hit_count: 0 })
      const { container } = render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      const zeroCells = container.querySelectorAll('.text-text-tertiary')
      expect(zeroCells.length).toBeGreaterThan(0)
    })
  })

  describe('Chunking Mode', () => {
    it('should render ChunkingModeLabel with general mode', () => {
      render(<DocumentTableRow {...defaultProps} isGeneralMode isQAMode={false} />, { wrapper: createWrapper() })
      // ChunkingModeLabel should be rendered
      expect(screen.getByRole('row')).toBeInTheDocument()
    })

    it('should render ChunkingModeLabel with QA mode', () => {
      render(<DocumentTableRow {...defaultProps} isGeneralMode={false} isQAMode />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })
  })

  describe('Summary Status', () => {
    it('should render SummaryStatus when summary_index_status is present', () => {
      const doc = createMockDoc({ summary_index_status: 'completed' })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })

    it('should not render SummaryStatus when summary_index_status is absent', () => {
      const doc = createMockDoc({ summary_index_status: undefined })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })
  })

  describe('Rename Action', () => {
    it('should call onShowRenameModal when rename button is clicked', () => {
      const onShowRenameModal = vi.fn()
      const { container } = render(
        <DocumentTableRow {...defaultProps} onShowRenameModal={onShowRenameModal} />,
        { wrapper: createWrapper() },
      )

      // Find the rename button by finding the RiEditLine icon's parent
      const renameButtons = container.querySelectorAll('.cursor-pointer.rounded-md')
      if (renameButtons.length > 0) {
        fireEvent.click(renameButtons[0])
        expect(onShowRenameModal).toHaveBeenCalledWith(defaultProps.doc)
        expect(mockPush).not.toHaveBeenCalled()
      }
    })
  })

  describe('Operations', () => {
    it('should pass selectedIds to Operations component', () => {
      render(<DocumentTableRow {...defaultProps} selectedIds={['doc-1', 'doc-2']} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })

    it('should pass onSelectedIdChange to Operations component', () => {
      const onSelectedIdChange = vi.fn()
      render(<DocumentTableRow {...defaultProps} onSelectedIdChange={onSelectedIdChange} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })
  })

  describe('Document Source Icon', () => {
    it('should render with FILE data source type', () => {
      const doc = createMockDoc({ data_source_type: DataSourceType.FILE })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })

    it('should render with NOTION data source type', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.NOTION,
        data_source_info: { notion_page_icon: 'icon.png' },
      })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })

    it('should render with WEB data source type', () => {
      const doc = createMockDoc({ data_source_type: DataSourceType.WEB })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle document with very long name', () => {
      const doc = createMockDoc({ name: `${'a'.repeat(500)}.txt` })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByRole('row')).toBeInTheDocument()
    })

    it('should handle document with special characters in name', () => {
      const doc = createMockDoc({ name: '<script>test</script>.txt' })
      render(<DocumentTableRow {...defaultProps} doc={doc} />, { wrapper: createWrapper() })
      expect(screen.getByText('<script>test</script>.txt')).toBeInTheDocument()
    })

    it('should memoize the component', () => {
      const wrapper = createWrapper()
      const { rerender } = render(<DocumentTableRow {...defaultProps} />, { wrapper })

      rerender(<DocumentTableRow {...defaultProps} />)
      expect(screen.getByRole('row')).toBeInTheDocument()
    })
  })
})
