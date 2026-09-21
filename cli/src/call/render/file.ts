import type { Renderer } from './index'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unknownError } from '@/errors/base'
import { renderJsonLine } from './object'

const CONTENT_DISPOSITION_HEADER = 'content-disposition'
const CONTENT_TYPE_HEADER = 'content-type'
const DEFAULT_DOWNLOAD_FILENAME = 'download.bin'

const QUOTED_FILENAME = /filename="([^"]+)"/
const BARE_FILENAME = /filename=([^;]+)/

function filenameFromContentDisposition(value: string | null): string | undefined {
  if (value === null) return undefined
  return QUOTED_FILENAME.exec(value)?.[1] ?? BARE_FILENAME.exec(value)?.[1]?.trim()
}

export const fileRenderer: Renderer = async (res, io, options) => {
  const bytes = new Uint8Array(await res.arrayBuffer())
  const filename =
    filenameFromContentDisposition(res.headers.get(CONTENT_DISPOSITION_HEADER)) ??
    DEFAULT_DOWNLOAD_FILENAME
  const path = options.output ?? join(process.cwd(), filename)

  try {
    await writeFile(path, bytes)
  } catch (cause) {
    throw unknownError(`failed to write file: ${path}`, cause)
  }

  // A content type the server never sent is absent, not empty.
  const contentType = res.headers.get(CONTENT_TYPE_HEADER)
  const receipt: Record<string, unknown> = { path, size: bytes.byteLength }
  if (contentType !== null) receipt.content_type = contentType
  return renderJsonLine(io, receipt)
}
