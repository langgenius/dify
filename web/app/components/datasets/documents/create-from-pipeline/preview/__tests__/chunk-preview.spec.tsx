import type { IndexingEstimateResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode } from '@/models/datasets'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import ChunkPreview from '../chunk-preview'

// Uses global react-i18next mock from web/vitest.setup.ts

// Mock dataset-detail context - needs mock to control return values
const mockDocForm = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    _selector: (s: { dataset: { doc_form: ChunkingMode } }) => ChunkingMode,
  ) => {
    return mockDocForm()
  },
}))

const createMockLocalFile = (overrides: Partial<CustomFile> = {}): CustomFile => {
  const { name = 'test-file.pdf', ...extra } = overrides
  return Object.assign(
    new File(['content'], name, { type: 'application/pdf', lastModified: 1700000000 }),
    { id: 'file-1', extension: 'pdf' },
    extra,
  )
}

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

const createMockEstimateData = (
  overrides?: Partial<IndexingEstimateResponse>,
): IndexingEstimateResponse => ({
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

  describe('Idle State', () => {
    it('should call onPreview when preview button is clicked', async () => {
      const user = userEvent.setup()
      const onPreview = vi.fn()

      render(<ChunkPreview {...defaultProps} isIdle={true} onPreview={onPreview} />)

      const button = screen.getByRole('button', { name: /previewChunks/i })
      await user.click(button)
      expect(onPreview).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loading State', () => {
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
        preview: [{ content: 'Parent chunk 1', child_chunks: ['Child 1', 'Child 2'] }],
      })

      render(<ChunkPreview {...defaultProps} estimateData={estimateData} />)

      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.getByText('Child 2')).toBeInTheDocument()
    })
  })

  describe('Document Selection', () => {
    it('should handle local file selection change', async () => {
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

      const user = userEvent.setup()
      await user.click(screen.getByText('file1.pdf'))
      await user.click(await screen.findByRole('button', { name: 'file2.pdf' }))
      expect(handlePreviewFileChange).toHaveBeenCalledWith(localFiles[1])
    })

    it('should handle online document selection change', async () => {
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

      const user = userEvent.setup()
      await user.click(screen.getByText('Page 1'))
      await user.click(await screen.findByRole('button', { name: 'Page 2' }))
      expect(handlePreviewOnlineDocumentChange).toHaveBeenCalledWith(onlineDocuments[1])
    })

    it('should handle website page selection change', async () => {
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

      const user = userEvent.setup()
      await user.click(screen.getByText('Site 1'))
      await user.click(await screen.findByRole('button', { name: 'Site 2' }))
      expect(handlePreviewWebsitePageChange).toHaveBeenCalledWith(websitePages[1])
    })

    it('should handle online drive file selection change', async () => {
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

      const user = userEvent.setup()
      await user.click(screen.getByText('file1.docx'))
      await user.click(await screen.findByRole('button', { name: 'file2.docx' }))
      expect(handlePreviewOnlineDriveFileChange).toHaveBeenCalledWith(onlineDriveFiles[1])
    })
  })
})
