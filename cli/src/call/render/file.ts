import type { Renderer } from './index'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unknownError } from '@/errors/base'
import { renderJsonLine } from './object'

const CONTENT_DISPOSITION_HEADER = 'content-disposition'
const CONTENT_TYPE_HEADER = 'content-type'
const UNKNOWN_EXTENSION = 'bin'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/json': 'json',
  'application/x-yaml': 'yaml',
  'application/yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'application/pdf': 'pdf',
}

const QUOTED_FILENAME = /filename="([^"]+)"/
const BARE_FILENAME = /filename=([^;]+)/

function filenameFromContentDisposition(value: string | null): string | undefined {
  if (value === null) return undefined
  return QUOTED_FILENAME.exec(value)?.[1] ?? BARE_FILENAME.exec(value)?.[1]?.trim()
}

function extensionOf(contentType: string | null): string {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[mediaType] ?? UNKNOWN_EXTENSION
}

export const fileRenderer: Renderer = async (res, io, options, opId) => {
  const bytes = new Uint8Array(await res.arrayBuffer())
  const contentType = res.headers.get(CONTENT_TYPE_HEADER)
  const filename =
    filenameFromContentDisposition(res.headers.get(CONTENT_DISPOSITION_HEADER)) ??
    `${opId}.${extensionOf(contentType)}`
  const path = options.output ?? join(process.cwd(), filename)

  try {
    await writeFile(path, bytes)
  } catch (cause) {
    throw unknownError(`failed to write file: ${path}`, cause)
  }

  // A content type the server never sent is absent, not empty.
  const receipt: Record<string, unknown> = { path, size: bytes.byteLength }
  if (contentType !== null) receipt.content_type = contentType
  return renderJsonLine(io, receipt)
}
