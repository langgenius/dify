import type { Renderer } from './index'
import { writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { CALL_FLAG } from '@/call/flags'
import { BaseError, unknownError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { renderJson } from './object'

const CONTENT_DISPOSITION_HEADER = 'content-disposition'
const CONTENT_TYPE_HEADER = 'content-type'
const UNKNOWN_EXTENSION = 'bin'
const EEXIST = 'EEXIST'
// A name the server picked never replaces a file; a path the caller named does.
const CREATE_ONLY = 'wx'
const CREATE_OR_REPLACE = 'w'

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
const NOT_A_FILE_NAME: readonly string[] = ['', '.', '..']

// Only the last part of the server's name is used, so the file stays in the folder.
function baseName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const name = posix.basename(raw.replaceAll('\\', '/'))
  return NOT_A_FILE_NAME.includes(name) ? undefined : name
}

function filenameFromContentDisposition(value: string | null): string | undefined {
  if (value === null) return undefined
  return baseName(QUOTED_FILENAME.exec(value)?.[1] ?? BARE_FILENAME.exec(value)?.[1]?.trim())
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
  const flag = options.output === undefined ? CREATE_ONLY : CREATE_OR_REPLACE

  try {
    await writeFile(path, bytes, { flag })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === EEXIST)
      throw new BaseError({
        code: ErrorCode.UsageMissingArg,
        message: `${path} already exists; not overwriting it`,
        hint: `pass --${CALL_FLAG.Output} <path> to choose where to save it`,
        cause,
      })
    throw unknownError(`failed to write file: ${path}`, cause)
  }

  // A content type the server never sent is absent, not empty.
  const receipt: Record<string, unknown> = { path, size: bytes.byteLength }
  if (contentType !== null) receipt.content_type = contentType
  return renderJson(io, receipt)
}
