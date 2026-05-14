import type { SimpleDocumentDetail } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { DocumentPicker } from '../index'

let mockDocumentListData: { data: SimpleDocumentDetail[] } | undefined

const { mockUseDocumentList } = vi.hoisted(() => ({
  mockUseDocumentList: vi.fn(),
}))

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentList: mockUseDocumentList,
}))

const createDocument = (overrides: Partial<SimpleDocumentDetail> = {}): SimpleDocumentDetail => ({
  id: 'doc-1',
  batch: 'batch-1',
  position: 1,
  dataset_id: 'dataset-1',
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'document.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: Date.now(),
    },
    job_id: 'job-1',
    url: '',
  },
  dataset_process_rule_id: 'rule-1',
  name: 'Document 1',
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
      name: 'document.pdf',
      extension: 'pdf',
    },
  },
  ...overrides,
})

const createProps = (overrides: Partial<React.ComponentProps<typeof DocumentPicker>> = {}) => ({
  datasetId: 'dataset-1',
  value: createDocument({ id: 'doc-1', name: 'Document 1' }),
  onChange: vi.fn(),
  ...overrides,
})

const renderDocumentPicker = (props: Partial<React.ComponentProps<typeof DocumentPicker>> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const defaultProps = createProps(props)

  return {
    props: defaultProps,
    ...render(
      <QueryClientProvider client={queryClient}>
        <DocumentPicker {...defaultProps} />
      </QueryClientProvider>,
    ),
  }
}

describe('DocumentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocumentListData = {
      data: [
        createDocument({ id: 'doc-1', name: 'Document 1' }),
        createDocument({ id: 'doc-2', name: 'Document 2' }),
      ],
    }
    mockUseDocumentList.mockImplementation(() => ({
      data: mockDocumentListData,
    }))
  })

  it('should render the current document and chunking mode', () => {
    renderDocumentPicker({
      value: createDocument({
        id: 'current-doc',
        name: 'Current Document',
        doc_form: ChunkingMode.parentChild,
      }),
      parentMode: 'paragraph',
    })

    expect(screen.getByRole('combobox', { name: 'Current Document' })).toBeInTheDocument()
    expect(screen.getByText(/dataset.chunkingMode.parentChild/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.parentMode.paragraph/)).toBeInTheDocument()
  })

  it('should fetch documents with the current dataset and search keyword', async () => {
    const user = userEvent.setup()
    renderDocumentPicker({ datasetId: 'dataset-custom' })

    await user.click(screen.getByRole('combobox', { name: 'Document 1' }))
    await user.type(screen.getByPlaceholderText('common.operation.search'), 'report')

    await waitFor(() => {
      expect(mockUseDocumentList).toHaveBeenLastCalledWith({
        datasetId: 'dataset-custom',
        query: {
          keyword: 'report',
          page: 1,
          limit: 20,
        },
      })
    })
  })

  it('should keep focus in the search input while deleting quickly', async () => {
    const user = userEvent.setup()
    renderDocumentPicker()

    const trigger = screen.getByRole('combobox', { name: 'Document 1' })
    await user.click(trigger)

    const searchInput = screen.getByPlaceholderText('common.operation.search')
    await user.type(searchInput, 'report')
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}')

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(searchInput).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('should keep focus in the search input while typing quickly', async () => {
    const user = userEvent.setup()
    renderDocumentPicker()

    const trigger = screen.getByRole('combobox', { name: 'Document 1' })
    await user.click(trigger)

    const searchInput = screen.getByPlaceholderText('common.operation.search')
    await user.keyboard('quarterly-report-final')

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(searchInput).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('should call onChange with the selected document', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const selectedDocument = createDocument({ id: 'doc-2', name: 'Document 2' })
    mockDocumentListData = {
      data: [
        createDocument({ id: 'doc-1', name: 'Document 1' }),
        selectedDocument,
      ],
    }

    renderDocumentPicker({ onChange })

    await user.click(screen.getByRole('combobox', { name: 'Document 1' }))
    await user.click(await screen.findByRole('option', { name: /Document 2/ }))

    expect(onChange).toHaveBeenCalledWith(selectedDocument)
  })

  it('should show an empty state when no documents match', async () => {
    const user = userEvent.setup()
    mockDocumentListData = { data: [] }

    renderDocumentPicker()

    await user.click(screen.getByRole('combobox', { name: 'Document 1' }))

    expect(await screen.findByRole('status')).toHaveTextContent('common.noData')
  })
})
