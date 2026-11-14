import { describe, expect, it } from 'vite-plus/test'
import {
  getLocalFileExtension,
  getNotionPageIcon,
  getOnlineDriveFileName,
  getUploadFileExtension,
  isDownloadableFileDocument,
} from '../document-source'

describe('document source info', () => {
  it('recognizes legacy and pipeline documents with downloadable files', () => {
    expect(isDownloadableFileDocument('upload_file', null)).toBe(true)
    expect(isDownloadableFileDocument('local_file', { real_file_id: 'file-1' })).toBe(true)
    expect(isDownloadableFileDocument('local_file', { related_id: 'file-2' })).toBe(true)
    expect(isDownloadableFileDocument('local_file', { reference: 'dify-file-ref:encoded' })).toBe(
      true,
    )
    expect(isDownloadableFileDocument('local_file', { file_path: '/tmp/document.pdf' })).toBe(false)
    expect(isDownloadableFileDocument('online_document', { related_id: 'file-2' })).toBe(false)
  })

  it('should read the uploaded file extension of legacy file documents', () => {
    expect(getUploadFileExtension({ upload_file: { extension: 'pdf' } })).toBe('pdf')
    expect(getUploadFileExtension({ upload_file: 'broken' })).toBeUndefined()
    expect(getUploadFileExtension(null)).toBeUndefined()
  })

  it('should read pipeline file details', () => {
    expect(getLocalFileExtension({ extension: 'md' })).toBe('md')
    expect(getOnlineDriveFileName({ name: 'report.docx' })).toBe('report.docx')
    expect(getOnlineDriveFileName({ name: 3 })).toBeUndefined()
  })

  it('should read the Notion page icon for imports and pipeline pages', () => {
    const icon = { type: 'emoji', emoji: '📄', url: null }

    expect(getNotionPageIcon({ notion_page_icon: 'https://icon.url' }, false)).toBe(
      'https://icon.url',
    )
    expect(getNotionPageIcon({ page: { page_icon: icon } }, true)).toEqual(icon)
    expect(getNotionPageIcon({ page: { page_icon: 42 } }, true)).toBeUndefined()
    expect(getNotionPageIcon({ notion_page_icon: icon }, true)).toBeUndefined()
  })
})
