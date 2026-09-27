import { describe, expect, it } from 'vite-plus/test'
import { getDriveFileIconType, getFileIconType } from '../file-icon'

describe('agent file icon helpers', () => {
  it('should infer supported icons for uploaded drive file pointer kinds', () => {
    expect(
      getDriveFileIconType({
        fileKind: 'upload_file',
        fileName: 'report.md',
        mimeType: 'text/markdown',
      }),
    ).toBe('markdown')
    expect(
      getDriveFileIconType({
        fileKind: 'tool_file',
        fileName: 'image.png',
        mimeType: 'image/png',
      }),
    ).toBe('image')
  })

  it('should keep supported drive file kinds and normalize directories', () => {
    expect(
      getDriveFileIconType({
        fileKind: 'directory',
        fileName: 'files',
      }),
    ).toBe('folder')
    expect(
      getDriveFileIconType({
        fileKind: 'pdf',
        fileName: 'guide',
      }),
    ).toBe('pdf')
  })

  it('should infer icons from file extension when mime type is not enough', () => {
    expect(getFileIconType('data.csv')).toBe('table')
    expect(getFileIconType('archive.zip')).toBe('archive')
    expect(getFileIconType('script.ts')).toBe('code')
  })

  it.each([
    ['references/notes.txt', undefined],
    ['references/NOTES.TXT', undefined],
    ['references/notes.txt', 'text/plain'],
    ['references/notes.txt', 'application/octet-stream'],
  ])('should identify %s as text regardless of MIME metadata (%s)', (fileName, mimeType) => {
    expect(getFileIconType(fileName, mimeType)).toBe('text')
  })

  it('should keep unrecognized binary files as generic files', () => {
    expect(getFileIconType('data.bin', 'application/octet-stream')).toBe('file')
  })
})
