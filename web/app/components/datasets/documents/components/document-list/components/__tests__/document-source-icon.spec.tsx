import type { SimpleDocumentDetail } from '@/models/datasets'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'
import DocumentSourceIcon from '../document-source-icon'

const createMockDoc = (overrides: Record<string, unknown> = {}): SimpleDocumentDetail => ({
  id: 'doc-1',
  position: 1,
  data_source_type: DataSourceType.FILE,
  data_source_info: {},
  data_source_detail_dict: {},
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
  word_count: 100,
  hit_count: 10,
  doc_form: 'text_model',
  ...overrides,
}) as unknown as SimpleDocumentDetail

describe('DocumentSourceIcon', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const doc = createMockDoc()
      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Local File Icon', () => {
    it('should render FileTypeIcon for FILE data source type', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.FILE,
        data_source_info: {
          upload_file: { extension: 'pdf' },
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} fileType="pdf" />)
      const icon = container.querySelector('svg, img')
      expect(icon).toBeInTheDocument()
    })

    it('should render FileTypeIcon for localFile data source type', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.localFile,
        created_from: 'rag-pipeline',
        data_source_info: {
          extension: 'docx',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      const icon = container.querySelector('svg, img')
      expect(icon).toBeInTheDocument()
    })

    it('should use extension from upload_file for legacy data source', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.FILE,
        created_from: 'web',
        data_source_info: {
          upload_file: { extension: 'txt' },
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should use fileType prop as fallback for extension', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.FILE,
        created_from: 'web',
        data_source_info: {},
      })

      const { container } = render(<DocumentSourceIcon doc={doc} fileType="csv" />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Notion Icon', () => {
    it('should render NotionIcon for NOTION data source type', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.NOTION,
        created_from: 'web',
        data_source_info: {
          notion_page_icon: 'https://notion.so/icon.png',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render NotionIcon for onlineDocument data source type', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.onlineDocument,
        created_from: 'rag-pipeline',
        data_source_info: {
          page: { page_icon: 'https://notion.so/icon.png' },
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should use page_icon for rag-pipeline created documents', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.NOTION,
        created_from: 'rag-pipeline',
        data_source_info: {
          page: { page_icon: 'https://notion.so/custom-icon.png' },
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Web Crawl Icon', () => {
    it('should render globe icon for WEB data source type', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.WEB,
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
      expect(icon).toHaveClass('mr-1.5')
      expect(icon).toHaveClass('size-4')
    })

    it('should render globe icon for websiteCrawl data source type', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.websiteCrawl,
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Online Drive Icon', () => {
    it('should render FileTypeIcon for onlineDrive data source type', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.onlineDrive,
        data_source_info: {
          name: 'document.xlsx',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should extract extension from file name', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.onlineDrive,
        data_source_info: {
          name: 'spreadsheet.xlsx',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle file name without extension', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.onlineDrive,
        data_source_info: {
          name: 'noextension',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty file name', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.onlineDrive,
        data_source_info: {
          name: '',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle hidden files (starting with dot)', () => {
      const doc = createMockDoc({
        data_source_type: DatasourceType.onlineDrive,
        data_source_info: {
          name: '.gitignore',
        },
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Unknown Data Source Type', () => {
    it('should return null for unknown data source type', () => {
      const doc = createMockDoc({
        data_source_type: 'unknown',
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined data_source_info', () => {
      const doc = createMockDoc({
        data_source_type: DataSourceType.FILE,
        data_source_info: undefined,
      })

      const { container } = render(<DocumentSourceIcon doc={doc} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should memoize the component', () => {
      const doc = createMockDoc()
      const { rerender, container } = render(<DocumentSourceIcon doc={doc} />)

      const firstRender = container.innerHTML
      rerender(<DocumentSourceIcon doc={doc} />)
      expect(container.innerHTML).toBe(firstRender)
    })
  })
})
