import type { ParsedFileFlag } from './file-flags'
import { describe, expect, it, vi } from 'vitest'
import { difyFileType, parseFileFlag, resolveFileInputs } from './file-flags'

describe('parseFileFlag', () => {
  it('parses local file with @ prefix', () => {
    expect(parseFileFlag('doc=@/tmp/report.pdf')).toEqual<ParsedFileFlag>({
      varname: 'doc',
      kind: 'local',
      path: '/tmp/report.pdf',
    })
  })

  it('parses remote https URL', () => {
    expect(parseFileFlag('img=https://cdn.example.com/logo.png')).toEqual<ParsedFileFlag>({
      varname: 'img',
      kind: 'remote',
      url: 'https://cdn.example.com/logo.png',
    })
  })

  it('parses remote http URL', () => {
    expect(parseFileFlag('f=http://host/a.pdf')).toEqual<ParsedFileFlag>({
      varname: 'f',
      kind: 'remote',
      url: 'http://host/a.pdf',
    })
  })

  it('throws on missing = separator', () => {
    expect(() => parseFileFlag('noequalssign')).toThrow(
      '--file must be key=@path or key=https://url',
    )
  })

  it('throws on value that is neither @ nor URL', () => {
    expect(() => parseFileFlag('doc=justaplainstring')).toThrow(
      '--file value must start with @ (local file) or http(s):// (remote URL)',
    )
  })

  it('throws on empty varname', () => {
    expect(() => parseFileFlag('=@/path')).toThrow('--file varname must not be empty')
  })
})

describe('difyFileType', () => {
  it('detects image', () => {
    expect(difyFileType('photo.jpg')).toBe('image')
    expect(difyFileType('logo.PNG')).toBe('image')
    expect(difyFileType('icon.svg')).toBe('image')
  })

  it('detects audio', () => {
    expect(difyFileType('clip.mp3')).toBe('audio')
    expect(difyFileType('sound.WAV')).toBe('audio')
  })

  it('detects video', () => {
    expect(difyFileType('video.mp4')).toBe('video')
    expect(difyFileType('clip.MOV')).toBe('video')
  })

  it('returns document for known doc extensions', () => {
    expect(difyFileType('report.pdf')).toBe('document')
    expect(difyFileType('notes.md')).toBe('document')
  })

  it('returns document for unknown extension', () => {
    expect(difyFileType('data.xyz')).toBe('document')
  })

  it('returns custom for no extension', () => {
    expect(difyFileType('noext')).toBe('custom')
  })
})

describe('resolveFileInputs', () => {
  it('remote URL: injects remote_url object without calling upload', async () => {
    const upload = vi.fn()
    const result = await resolveFileInputs('app-1', ['doc=https://example.com/report.pdf'], upload)
    expect(upload).not.toHaveBeenCalled()
    expect(result).toEqual({
      doc: {
        type: 'document',
        transfer_method: 'remote_url',
        url: 'https://example.com/report.pdf',
      },
    })
  })

  it('remote URL with query string: extracts correct extension', async () => {
    const upload = vi.fn()
    const result = await resolveFileInputs(
      'app-1',
      ['img=https://cdn.example.com/photo.jpg?token=abc'],
      upload,
    )
    expect(result.img).toMatchObject({ type: 'image', transfer_method: 'remote_url' })
  })

  it('local file: calls upload and injects local_file object', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'file-uuid-1' })
    const result = await resolveFileInputs('app-1', ['doc=@/tmp/report.pdf'], upload)
    expect(upload).toHaveBeenCalledWith('app-1', '/tmp/report.pdf')
    expect(result).toEqual({
      doc: { type: 'document', transfer_method: 'local_file', upload_file_id: 'file-uuid-1' },
    })
  })

  it('multiple flags: produces multiple entries keyed by varname', async () => {
    const upload = vi.fn().mockResolvedValue({ id: 'file-uuid-2' })
    const result = await resolveFileInputs(
      'app-1',
      ['img=https://x.com/logo.png', 'doc=@/tmp/file.pdf'],
      upload,
    )
    expect(Object.keys(result)).toHaveLength(2)
    expect(result.img).toMatchObject({ transfer_method: 'remote_url' })
    expect(result.doc).toMatchObject({
      transfer_method: 'local_file',
      upload_file_id: 'file-uuid-2',
    })
  })

  it('upload failure: throws with context including varname and path', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('413 File too large'))
    await expect(resolveFileInputs('app-1', ['doc=@/tmp/big.pdf'], upload)).rejects.toThrow(
      '--file doc: upload of /tmp/big.pdf failed',
    )
  })
})
