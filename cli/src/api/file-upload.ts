import type { HttpClient } from '@/http/types'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export type UploadedFile = {
  id: string
  name: string
  size: number
  extension: string | null
  mime_type: string | null
}

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  amr: 'audio/amr',
  mpga: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mpeg: 'video/mpeg',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  epub: 'application/epub+zip',
  vtt: 'text/vtt',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function mimeFromFilename(filename: string): string {
  const ext = extname(filename).replace(/^\./, '').toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

export class FileUploadClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async upload(appId: string, filePath: string): Promise<UploadedFile> {
    const filename = basename(filePath)
    const content = await readFile(filePath)
    const blob = new Blob([content], { type: mimeFromFilename(filename) })
    const form = new FormData()
    form.append('file', blob, filename)

    return this.http.post<UploadedFile>(
      `apps/${encodeURIComponent(appId)}/files/upload`,
      { body: form, timeoutMs: 60_000 },
    )
  }
}
