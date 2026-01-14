import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile, FileIndexingEstimateResponse } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode } from '@/models/datasets'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import ChunkPreview from './chunk-preview'

// Uses global react-i18next mock from web/vitest.setup.ts

// Mock dataset-detail context - needs mock to control return values
const mockDocForm = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (_selector: (s: { dataset: { doc_form: ChunkingMode } }) => ChunkingMode) => {
    return mockDocForm()
  },
}))

// Mock document picker - needs mock for simplified interaction testing
vi.mock('../../../common/document-picker/preview-document-picker', () => ({
  default: ({ files, onChange, value }: {
    files: Array<{ id: string, name: string, extension: string }>
    onChange: (selected: { id: string, name: string, extension: string }) => void
    value: { id: string, name: string, extension: string }
  }) => (
    <div data-testid="document-picker">
      <span data-testid="picker-value">{value?.name || 'No selection'}</span>
      <select
        data-testid="picker-select"
        value={value?.id || ''}
        onChange={(e) => {
          const selected = files.find(f => f.id === e.target.value)
          if (selected)
            onChange(selected)
        }}
      >
        {files.map(f => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
    </div>
  ),
}))

// Test data factories
const createMockLocalFile = (overrides?: Partial<CustomFile>): CustomFile => ({
  id: 'file-1',
  name: 'test-file.pdf',
  size: 1024,
  type: 'application/pdf',
  extension: 'pdf',
  lastModified: Date.now(),
  webkitRelativePath: '',
  arrayBuffer: vi.fn() as () => Promise<ArrayBuffer>,
  bytes: vi.fn() as () => Promise<Uint8Array>,
  slice: vi.fn() as (start?: number, end?: number, contentType?: string) => Blob,
  stream: vi.fn() as () => ReadableStream<Uint8Array>,
  text: vi.fn() as () => Promise<string>,
  ...overrides,
} as CustomFile)

const createMockNotionPage = (overrides?: Partial<NotionPage>): NotionPage => ({
  page_id: 'page-1',
  page_name: 'Test Page',
  workspace_id: 'workspace-1',
  type: 'page',
  page_icon: null,
  parent_id: 'parent-1',
  is_bound: true,
  ...overrides,
})

const createMockCrawlResult = (overrides?: Partial<CrawlResultItem>): CrawlResultItem => ({
  title: 'Test Website',
  markdown: 'Test content',
  description: 'Test description',
  source_url: 'https://example.com',
  ...overrides,
})

const createMockOnlineDriveFile = (overrides?: Partial<OnlineDriveFile>): OnlineDriveFile => ({
  id: 'drive-file-1',
  name: 'test-drive-file.docx',
  size: 2048,
  type: OnlineDriveFileType.file,
  ...overrides,
})

const createMockEstimateData = (overrides?: Partial<FileIndexingEstimateResponse>): FileIndexingEstimateResponse => ({
  total_nodes: 5,
  tokens: 1000,
  total_price: 0.01,
  currency: 'USD',
  total_segments: 10,
  preview: [
    { content: 'Chunk content 1', child_chunks: ['child 1', 'child 2'] },
    { content: 'Chunk content 2', child_chunks: ['child 3'] },
  ],
  qa_preview: [
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
  ],
  ...overrides,
})

const defaultProps = {
  dataSourceType: DatasourceType.localFile,
  localFiles: [createMockLocalFile()],
  onlineDocuments: [createMockNotionPage()],
  websitePages: [createMockCrawlResult()],
  onlineDriveFiles: [createMockOnlineDriveFile()],
  isIdle: false,
  isPending: false,
  estimateData: undefined,
  onPreview: vi.fn(),
  handlePreviewFileChange: vi.fn(),
  handlePreviewOnlineDocumentChange: vi.fn(),
  handlePreviewWebsitePageChange: vi.fn(),
  handlePreviewOnlineDriveFileChange: vi.fn(),
}

describe('ChunkPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.mockReturnValue(ChunkingMode.text)
  })

  describe('Rendering', () => {
    it('should render the component with preview container', () => {
      render(<ChunkPreview {...defaultProps} />)

      // i18n mock returns key by default
      expect(screen.getByText('datasetCreation.stepTwo.preview')).toBeInTheDocument()
    })

    it('should render document picker for local files', () => {
      render(<ChunkPreview {...defaultProps} dataSourceType={DatasourceType.localFile} />)

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should render document picker for online documents', () => {
      render(<ChunkPreview {...defaultProps} dataSourceType={DatasourceType.onlineDocument} />)

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should render document picker for website pages', () => {
      render(<ChunkPreview {...defaultProps} dataSourceType={DatasourceType.websiteCrawl} />)

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should render document picker for online drive files', () => {
      render(<ChunkPreview {...defaultProps} dataSourceType={DatasourceType.onlineDrive} />)

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should render badge with chunk count for non-QA mode', () => {
      const estimateData = createMockEstimateData({ total_segments: 15 })
      mockDocForm.mockReturnValue(ChunkingMode.text)

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      // Badge shows chunk count via i18n key with count option
      expect(screen.getByText(/previewChunkCount.*15/)).toBeInTheDocument()
    })

    it('should not render badge for QA mode', () => {
      mockDocForm.mockReturnValue(ChunkingMode.qa)
      const estimateData = createMockEstimateData()

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      // No badge with total_segments
      expect(screen.queryByText(/10/)).not.toBeInTheDocument()
    })
  })

  describe('Idle State', () => {
    it('should render idle state with preview tip and button', () => {
      render(<ChunkPreview {...defaultProps} isIdle={true} />)

      // i18n mock returns keys
      expect(screen.getByText('datasetCreation.stepTwo.previewChunkTip')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.previewChunks')).toBeInTheDocument()
    })

    it('should call onPreview when preview button is clicked', () => {
      const onPreview = vi.fn()

      render(<ChunkPreview {...defaultProps} isIdle={true} onPreview={onPreview} />)

      const button = screen.getByRole('button', { name: /previewChunks/i })
      fireEvent.click(button)
      expect(onPreview).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loading State', () => {
    it('should render skeleton loading when isPending is true', () => {
      render(<ChunkPreview {...defaultProps} isPending={true} />)

      // Skeleton loading renders multiple skeleton containers
      expect(document.querySelector('.space-y-6')).toBeInTheDocument()
    })

    it('should not render preview content when loading', () => {
      const estimateData = createMockEstimateData()

      render(<ChunkPreview {...defaultProps} isPending={true} estimateData={estimateData} />)

      expect(screen.queryByText('Chunk content 1')).not.toBeInTheDocument()
    })
  })

  describe('QA Mode Preview', () => {
    it('should render QA preview chunks when doc_form is qa', () => {
      mockDocForm.mockReturnValue(ChunkingMode.qa)
      const estimateData = createMockEstimateData({
        qa_preview: [
          { question: 'Question 1?', answer: 'Answer 1' },
          { question: 'Question 2?', answer: 'Answer 2' },
        ],
      })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.getByText('Question 1?')).toBeInTheDocument()
      expect(screen.getByText('Answer 1')).toBeInTheDocument()
      expect(screen.getByText('Question 2?')).toBeInTheDocument()
      expect(screen.getByText('Answer 2')).toBeInTheDocument()
    })
  })

  describe('Text Mode Preview', () => {
    it('should render text preview chunks when doc_form is text', () => {
      mockDocForm.mockReturnValue(ChunkingMode.text)
      const estimateData = createMockEstimateData({
        preview: [
          { content: 'Text chunk 1', child_chunks: [] },
          { content: 'Text chunk 2', child_chunks: [] },
        ],
      })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.getByText('Text chunk 1')).toBeInTheDocument()
      expect(screen.getByText('Text chunk 2')).toBeInTheDocument()
    })
  })

  describe('Parent-Child Mode Preview', () => {
    it('should render parent-child preview chunks', () => {
      mockDocForm.mockReturnValue(ChunkingMode.parentChild)
      const estimateData = createMockEstimateData({
        preview: [
          { content: 'Parent chunk 1', child_chunks: ['Child 1', 'Child 2'] },
        ],
      })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.getByText('Child 2')).toBeInTheDocument()
    })
  })

  describe('Document Selection', () => {
    it('should handle local file selection change', () => {
      const handlePreviewFileChange = vi.fn()
      const localFiles = [
        createMockLocalFile({ id: 'file-1', name: 'file1.pdf' }),
        createMockLocalFile({ id: 'file-2', name: 'file2.pdf' }),
      ]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.localFile}
          localFiles={localFiles}
          handlePreviewFileChange={handlePreviewFileChange}
        />,
      )

      const select = screen.getByTestId('picker-select')
      fireEvent.change(select, { target: { value: 'file-2' } })

      expect(handlePreviewFileChange).toHaveBeenCalled()
    })

    it('should handle online document selection change', () => {
      const handlePreviewOnlineDocumentChange = vi.fn()
      const onlineDocuments = [
        createMockNotionPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockNotionPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.onlineDocument}
          onlineDocuments={onlineDocuments}
          handlePreviewOnlineDocumentChange={handlePreviewOnlineDocumentChange}
        />,
      )

      const select = screen.getByTestId('picker-select')
      fireEvent.change(select, { target: { value: 'page-2' } })

      expect(handlePreviewOnlineDocumentChange).toHaveBeenCalled()
    })

    it('should handle website page selection change', () => {
      const handlePreviewWebsitePageChange = vi.fn()
      const websitePages = [
        createMockCrawlResult({ source_url: 'https://example1.com', title: 'Site 1' }),
        createMockCrawlResult({ source_url: 'https://example2.com', title: 'Site 2' }),
      ]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.websiteCrawl}
          websitePages={websitePages}
          handlePreviewWebsitePageChange={handlePreviewWebsitePageChange}
        />,
      )

      const select = screen.getByTestId('picker-select')
      fireEvent.change(select, { target: { value: 'https://example2.com' } })

      expect(handlePreviewWebsitePageChange).toHaveBeenCalled()
    })

    it('should handle online drive file selection change', () => {
      const handlePreviewOnlineDriveFileChange = vi.fn()
      const onlineDriveFiles = [
        createMockOnlineDriveFile({ id: 'drive-1', name: 'file1.docx' }),
        createMockOnlineDriveFile({ id: 'drive-2', name: 'file2.docx' }),
      ]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.onlineDrive}
          onlineDriveFiles={onlineDriveFiles}
          handlePreviewOnlineDriveFileChange={handlePreviewOnlineDriveFileChange}
        />,
      )

      const select = screen.getByTestId('picker-select')
      fireEvent.change(select, { target: { value: 'drive-2' } })

      expect(handlePreviewOnlineDriveFileChange).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty estimate data', () => {
      mockDocForm.mockReturnValue(ChunkingMode.text)

      render(<ChunkPreview {...defaultProps} estimateData={undefined} />)

      expect(screen.queryByText('Chunk content')).not.toBeInTheDocument()
    })

    it('should handle empty preview array', () => {
      mockDocForm.mockReturnValue(ChunkingMode.text)
      const estimateData = createMockEstimateData({ preview: [] })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.queryByText('Chunk content')).not.toBeInTheDocument()
    })

    it('should handle empty qa_preview array', () => {
      mockDocForm.mockReturnValue(ChunkingMode.qa)
      const estimateData = createMockEstimateData({ qa_preview: [] })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.queryByText('Q1')).not.toBeInTheDocument()
    })

    it('should handle empty child_chunks in parent-child mode', () => {
      mockDocForm.mockReturnValue(ChunkingMode.parentChild)
      const estimateData = createMockEstimateData({
        preview: [{ content: 'Parent', child_chunks: [] }],
      })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.queryByText('Child')).not.toBeInTheDocument()
    })

    it('should handle badge showing 0 chunks', () => {
      mockDocForm.mockReturnValue(ChunkingMode.text)
      const estimateData = createMockEstimateData({ total_segments: 0 })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      // Badge with 0
      expect(screen.getByText(/0/)).toBeInTheDocument()
    })

    it('should handle undefined online document properties', () => {
      const onlineDocuments = [createMockNotionPage({ page_id: '', page_name: '' })]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.onlineDocument}
          onlineDocuments={onlineDocuments}
        />,
      )

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should handle undefined website page properties', () => {
      const websitePages = [createMockCrawlResult({ source_url: '', title: '' })]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.websiteCrawl}
          websitePages={websitePages}
        />,
      )

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })

    it('should handle undefined online drive file properties', () => {
      const onlineDriveFiles = [createMockOnlineDriveFile({ id: '', name: '' })]

      render(
        <ChunkPreview
          {...defaultProps}
          dataSourceType={DatasourceType.onlineDrive}
          onlineDriveFiles={onlineDriveFiles}
        />,
      )

      expect(screen.getByTestId('document-picker')).toBeInTheDocument()
    })
  })

  describe('Component Memoization', () => {
    it('should be exported as a memoized component', () => {
      // ChunkPreview is wrapped with React.memo
      // We verify this by checking the component type
      expect(typeof ChunkPreview).toBe('object')
      expect(ChunkPreview.$$typeof?.toString()).toBe('Symbol(react.memo)')
    })
  })
})
