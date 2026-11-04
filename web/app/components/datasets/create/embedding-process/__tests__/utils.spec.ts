import type {
  DocumentResponse,
  DocumentStatusResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { createDocumentLookup, getFileType, getSourcePercent, isSourceEmbedding } from '../utils'

const status = (overrides: Partial<DocumentStatusResponse> = {}): DocumentStatusResponse => ({
  id: 'doc-1',
  indexing_status: 'indexing',
  processing_started_at: null,
  parsing_completed_at: null,
  cleaning_completed_at: null,
  splitting_completed_at: null,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  completed_segments: 0,
  total_segments: 0,
  ...overrides,
})

describe('isSourceEmbedding', () => {
  const embeddingStatuses = ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'] as const
  const nonEmbeddingStatuses = ['completed', 'error', 'paused'] as const

  it.each(embeddingStatuses)('should return true for status "%s"', (indexing_status) => {
    expect(isSourceEmbedding(status({ indexing_status }))).toBe(true)
  })

  it.each(nonEmbeddingStatuses)('should return false for status "%s"', (indexing_status) => {
    expect(isSourceEmbedding(status({ indexing_status }))).toBe(false)
  })
})

describe('getSourcePercent', () => {
  it('should calculate correct percentage', () => {
    expect(getSourcePercent(status({ completed_segments: 50, total_segments: 100 }))).toBe(50)
  })

  it('should return 0 when total is 0', () => {
    expect(getSourcePercent(status({ completed_segments: 0, total_segments: 0 }))).toBe(0)
  })

  it('should cap at 100', () => {
    expect(getSourcePercent(status({ completed_segments: 150, total_segments: 100 }))).toBe(100)
  })

  it('should round to nearest integer', () => {
    expect(getSourcePercent(status({ completed_segments: 1, total_segments: 3 }))).toBe(33)
  })

  it('treats absent segment totals as zero', () => {
    expect(getSourcePercent(status({ completed_segments: null, total_segments: null }))).toBe(0)
  })
})

describe('getFileType', () => {
  it('should extract extension from filename', () => {
    expect(getFileType('document.pdf')).toBe('pdf')
  })

  it('should return last extension for multi-dot names', () => {
    expect(getFileType('archive.tar.gz')).toBe('gz')
  })

  it('should default to "txt" for undefined', () => {
    expect(getFileType(undefined)).toBe('txt')
  })

  it('should default to "txt" for empty string', () => {
    expect(getFileType('')).toBe('txt')
  })
})

describe('createDocumentLookup', () => {
  const documents: DocumentResponse[] = [
    {
      data_source_detail_dict: {},
      id: 'doc-1',
      name: 'test.pdf',
      data_source_type: 'upload_file',
      data_source_info: {
        upload_file: { id: 'f1', name: 'test.pdf' },
        notion_page_icon: undefined,
      },
    },
    {
      data_source_detail_dict: {},
      id: 'doc-2',
      name: 'notion-page',
      data_source_type: 'notion_import',
      data_source_info: {
        upload_file: { id: 'f2', name: '' },
        notion_page_icon: 'https://icon.url',
      },
    },
  ]

  it('should get name by id', () => {
    const lookup = createDocumentLookup(documents)
    expect(lookup.getName('doc-1')).toBe('test.pdf')
  })

  it('should get source type by id', () => {
    const lookup = createDocumentLookup(documents)
    expect(lookup.getSourceType('doc-1')).toBe('upload_file')
  })

  it('should get notion icon for legacy data source', () => {
    const lookup = createDocumentLookup(documents)
    expect(lookup.getNotionIcon('doc-2')).toBe('https://icon.url')
  })

  it('should return undefined notion icon for non-legacy info', () => {
    const docs: DocumentResponse[] = [
      {
        id: 'doc-3',
        name: 'New source',
        data_source_detail_dict: {},
        data_source_info: { some_other: 'field' },
      },
    ]
    const lookup = createDocumentLookup(docs)
    expect(lookup.getNotionIcon('doc-3')).toBeUndefined()
  })

  it('should handle empty documents list', () => {
    const lookup = createDocumentLookup([])
    expect(lookup.getDocument('any')).toBeUndefined()
    expect(lookup.getName('any')).toBeUndefined()
  })
})
