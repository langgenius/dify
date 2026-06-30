import { describe, expect, it } from 'vitest'
import { getDriveFileIconType, getFileIconType } from '../file-icon'

describe('agent file icon helpers', () => {
  it('should infer supported icons for uploaded drive file pointer kinds', () => {
    expect(getDriveFileIconType({
      fileKind: 'upload_file',
      fileName: 'report.md',
      mimeType: 'text/markdown',
    })).toBe('markdown')
    expect(getDriveFileIconType({
      fileKind: 'tool_file',
      fileName: 'image.png',
      mimeType: 'image/png',
    })).toBe('image')
  })

  it('should keep supported drive file kinds and normalize directories', () => {
    expect(getDriveFileIconType({
      fileKind: 'directory',
      fileName: 'files',
    })).toBe('folder')
    expect(getDriveFileIconType({
      fileKind: 'pdf',
      fileName: 'guide',
    })).toBe('pdf')
  })

  it('should infer icons from file extension when mime type is not enough', () => {
    expect(getFileIconType('data.csv')).toBe('table')
    expect(getFileIconType('archive.zip')).toBe('archive')
    expect(getFileIconType('script.ts')).toBe('code')
  })
})
