import { describe, expect, it } from 'vitest'
import { isDownloadableFileDocument } from '../document-source'

describe('isDownloadableFileDocument', () => {
  it('accepts legacy uploads and pipeline documents with a file reference', () => {
    expect(isDownloadableFileDocument('upload_file', null)).toBe(true)
    expect(isDownloadableFileDocument('local_file', { real_file_id: 'file-1' })).toBe(true)
    expect(isDownloadableFileDocument('local_file', { related_id: 'file-2' })).toBe(true)
    expect(isDownloadableFileDocument('local_file', { reference: 'file-3' })).toBe(
      true,
    )
    expect(isDownloadableFileDocument('local_file', { file_path: '/tmp/document.pdf' })).toBe(false)
    expect(isDownloadableFileDocument('online_document', { related_id: 'file-2' })).toBe(false)
  })
})
