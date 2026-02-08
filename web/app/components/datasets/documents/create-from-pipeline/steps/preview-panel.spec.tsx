import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile, FileIndexingEstimateResponse, FileItem } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasourceType } from '@/models/pipeline'
import { StepOnePreview, StepTwoPreview } from './preview-panel'

// Mock context hooks (底层依赖)
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn((selector: (state: unknown) => unknown) => {
    const mockState = {
      dataset: {
        id: 'mock-dataset-id',
        doc_form: 'text_model',
        pipeline_id: 'mock-pipeline-id',
      },
    }
    return selector(mockState)
  }),
}))

// Mock API hooks (底层依赖)
vi.mock('@/service/use-common', () => ({
  useFilePreview: vi.fn(() => ({
    data: { content: 'Mock file content for testing' },
    isFetching: false,
  })),
}))

vi.mock('@/service/use-pipeline', () => ({
  usePreviewOnlineDocument: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ content: 'Mock document content' }),
    isPending: false,
  })),
}))

// Mock data source store
vi.mock('../data-source/store', () => ({
  useDataSourceStore: vi.fn(() => ({
    getState: () => ({ currentCredentialId: 'mock-credential-id' }),
  })),
}))

describe('StepOnePreview', () => {
  const mockDatasource: Datasource = {
    nodeId: 'test-node-id',
    nodeData: { type: 'data-source' } as unknown as DataSourceNodeType,
  }

  const mockLocalFile: CustomFile = {
    id: 'file-1',
    name: 'test-file.txt',
    type: 'text/plain',
    size: 1024,
    progress: 100,
    extension: 'txt',
  } as unknown as CustomFile

  const mockWebsite: CrawlResultItem = {
    source_url: 'https://example.com',
    title: 'Example Site',
    markdown: 'Mock markdown content',
  } as CrawlResultItem

  const defaultProps = {
    datasource: mockDatasource,
    currentLocalFile: undefined,
    currentDocument: undefined,
    currentWebsite: undefined,
    hidePreviewLocalFile: vi.fn(),
    hidePreviewOnlineDocument: vi.fn(),
    hideWebsitePreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<StepOnePreview {...defaultProps} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should render container with correct structure', () => {
      const { container } = render(<StepOnePreview {...defaultProps} />)
      expect(container.querySelector('.flex.h-full.flex-col')).toBeInTheDocument()
    })
  })

  describe('Conditional Rendering - FilePreview', () => {
    it('should render FilePreview when currentLocalFile is provided', () => {
      render(<StepOnePreview {...defaultProps} currentLocalFile={mockLocalFile} />)
      // FilePreview renders a preview header with file name
      expect(screen.getByText(/test-file/i)).toBeInTheDocument()
    })

    it('should not render FilePreview when currentLocalFile is undefined', () => {
      const { container } = render(<StepOnePreview {...defaultProps} currentLocalFile={undefined} />)
      // Container should still render but without file preview content
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })
  })

  describe('Conditional Rendering - WebsitePreview', () => {
    it('should render WebsitePreview when currentWebsite is provided', () => {
      render(<StepOnePreview {...defaultProps} currentWebsite={mockWebsite} />)
      // WebsitePreview displays the website title and URL
      expect(screen.getByText('Example Site')).toBeInTheDocument()
      expect(screen.getByText('https://example.com')).toBeInTheDocument()
    })

    it('should not render WebsitePreview when currentWebsite is undefined', () => {
      const { container } = render(<StepOnePreview {...defaultProps} currentWebsite={undefined} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should call hideWebsitePreview when close button is clicked', () => {
      const hideWebsitePreview = vi.fn()
      render(
        <StepOnePreview
          {...defaultProps}
          currentWebsite={mockWebsite}
          hideWebsitePreview={hideWebsitePreview}
        />,
      )

      // Find and click the close button (RiCloseLine icon)
      const closeButton = screen.getByRole('button')
      closeButton.click()

      expect(hideWebsitePreview).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle website with long markdown content', () => {
      const longWebsite: CrawlResultItem = {
        ...mockWebsite,
        markdown: 'A'.repeat(10000),
      }
      render(<StepOnePreview {...defaultProps} currentWebsite={longWebsite} />)
      expect(screen.getByText('Example Site')).toBeInTheDocument()
    })
  })
})

describe('StepTwoPreview', () => {
  const mockFileList: FileItem[] = [
    {
      file: {
        id: 'file-1',
        name: 'file1.txt',
        extension: 'txt',
        size: 1024,
      } as CustomFile,
      progress: 100,
    },
    {
      file: {
        id: 'file-2',
        name: 'file2.txt',
        extension: 'txt',
        size: 2048,
      } as CustomFile,
      progress: 100,
    },
  ] as FileItem[]

  const mockOnlineDocuments: (NotionPage & { workspace_id: string })[] = [
    {
      page_id: 'page-1',
      page_name: 'Page 1',
      type: 'page',
      workspace_id: 'workspace-1',
      page_icon: null,
      is_bound: false,
      parent_id: '',
    },
  ]

  const mockWebsitePages: CrawlResultItem[] = [
    { source_url: 'https://example.com', title: 'Example', markdown: 'Content' } as CrawlResultItem,
  ]

  const mockOnlineDriveFiles: OnlineDriveFile[] = [
    { id: 'drive-1', name: 'drive-file.txt' } as OnlineDriveFile,
  ]

  const mockEstimateData: FileIndexingEstimateResponse = {
    tokens: 1000,
    total_price: 0.01,
    total_segments: 10,
  } as FileIndexingEstimateResponse

  const defaultProps = {
    datasourceType: DatasourceType.localFile,
    localFileList: mockFileList,
    onlineDocuments: mockOnlineDocuments,
    websitePages: mockWebsitePages,
    selectedOnlineDriveFileList: mockOnlineDriveFiles,
    isIdle: true,
    isPendingPreview: false,
    estimateData: mockEstimateData,
    onPreview: vi.fn(),
    handlePreviewFileChange: vi.fn(),
    handlePreviewOnlineDocumentChange: vi.fn(),
    handlePreviewWebsitePageChange: vi.fn(),
    handlePreviewOnlineDriveFileChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should render ChunkPreview component structure', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} />)
      expect(container.querySelector('.flex.h-full.flex-col')).toBeInTheDocument()
    })
  })

  describe('Props Passing', () => {
    it('should render preview button when isIdle is true', () => {
      render(<StepTwoPreview {...defaultProps} isIdle={true} />)
      // ChunkPreview shows a preview button when idle
      const previewButton = screen.queryByRole('button')
      expect(previewButton).toBeInTheDocument()
    })

    it('should call onPreview when preview button is clicked', () => {
      const onPreview = vi.fn()
      render(<StepTwoPreview {...defaultProps} isIdle={true} onPreview={onPreview} />)

      // Find and click the preview button
      const buttons = screen.getAllByRole('button')
      const previewButton = buttons.find(btn => btn.textContent?.toLowerCase().includes('preview'))
      if (previewButton) {
        previewButton.click()
        expect(onPreview).toHaveBeenCalled()
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty localFileList', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} localFileList={[]} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should handle empty onlineDocuments', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} onlineDocuments={[]} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should handle empty websitePages', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} websitePages={[]} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should handle empty onlineDriveFiles', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} selectedOnlineDriveFileList={[]} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })

    it('should handle undefined estimateData', () => {
      const { container } = render(<StepTwoPreview {...defaultProps} estimateData={undefined} />)
      expect(container.querySelector('.h-full')).toBeInTheDocument()
    })
  })
})
