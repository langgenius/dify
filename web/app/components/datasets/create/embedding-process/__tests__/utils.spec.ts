import type { DataSourceInfo, FullDocumentDetail, IndexingStatusResponse } from '@/models/datasets'
import { describe, expect, it } from 'vitest'
import { createDocumentLookup, getFileType, getSourcePercent, isLegacyDataSourceInfo, isSourceEmbedding } from '../utils'

describe('isLegacyDataSourceInfo', () => {
  it('should return true when upload_file object exists', () => {
    const info = { upload_file: { id: '1', name: 'test.pdf' } } as unknown as DataSourceInfo
    expect(isLegacyDataSourceInfo(info)).toBe(true)
  })

  it('should return false when upload_file is absent', () => {
    const info = { notion_page_icon: 'icon' } as unknown as DataSourceInfo
    expect(isLegacyDataSourceInfo(info)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isLegacyDataSourceInfo(null as unknown as DataSourceInfo)).toBe(false)
  })

  it('should return false when upload_file is a string', () => {
    const info = { upload_file: 'not-an-object' } as unknown as DataSourceInfo
    expect(isLegacyDataSourceInfo(info)).toBe(false)
  })
})

describe('isSourceEmbedding', () => {
  const embeddingStatuses = ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting']
  const nonEmbeddingStatuses = ['completed', 'error', 'paused', 'unknown']

  it.each(embeddingStatuses)('should return true for status "%s"', (status) => {
    expect(isSourceEmbedding({ indexing_status: status } as IndexingStatusResponse)).toBe(true)
  })

  it.each(nonEmbeddingStatuses)('should return false for status "%s"', (status) => {
    expect(isSourceEmbedding({ indexing_status: status } as IndexingStatusResponse)).toBe(false)
  })
})

describe('getSourcePercent', () => {
  it('should calculate correct percentage', () => {
    expect(getSourcePercent({ completed_segments: 50, total_segments: 100 } as IndexingStatusResponse)).toBe(50)
  })

  it('should return 0 when total is 0', () => {
    expect(getSourcePercent({ completed_segments: 0, total_segments: 0 } as IndexingStatusResponse)).toBe(0)
  })

  it('should cap at 100', () => {
    expect(getSourcePercent({ completed_segments: 150, total_segments: 100 } as IndexingStatusResponse)).toBe(100)
  })

  it('should round to nearest integer', () => {
    expect(getSourcePercent({ completed_segments: 1, total_segments: 3 } as IndexingStatusResponse)).toBe(33)
  })

  it('should handle undefined segments as 0', () => {
    expect(getSourcePercent({} as IndexingStatusResponse)).toBe(0)
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
  const documents = [
    {
      id: 'doc-1',
      name: 'test.pdf',
      data_source_type: 'upload_file',
      data_source_info: {
        upload_file: { id: 'f1', name: 'test.pdf' },
        notion_page_icon: undefined,
      },
    },
    {
      id: 'doc-2',
      name: 'notion-page',
      data_source_type: 'notion_import',
      data_source_info: {
        upload_file: { id: 'f2', name: '' },
        notion_page_icon: 'https://icon.url',
      },
    },
  ] as unknown as FullDocumentDetail[]

  it('should get document by id', () => {
    const lookup = createDocumentLookup(documents)
    expect(lookup.getDocument('doc-1')).toBe(documents[0])
  })

  it('should return undefined for non-existent id', () => {
    const lookup = createDocumentLookup(documents)
    expect(lookup.getDocument('non-existent')).toBeUndefined()
  })

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
    const docs = [{
      id: 'doc-3',
      data_source_info: { some_other: 'field' },
    }] as unknown as FullDocumentDetail[]
    const lookup = createDocumentLookup(docs)
    expect(lookup.getNotionIcon('doc-3')).toBeUndefined()
  })

  it('should handle empty documents list', () => {
    const lookup = createDocumentLookup([])
    expect(lookup.getDocument('any')).toBeUndefined()
    expect(lookup.getName('any')).toBeUndefined()
  })
})
