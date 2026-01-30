import { unzip } from 'fflate'

const MAX_ZIP_SIZE = 50 * 1024 * 1024
const MAX_EXTRACTED_SIZE = 200 * 1024 * 1024
const MAX_FILE_COUNT = 200

type ZipValidationErrorCode
  = 'zip_too_large'
    | 'extracted_too_large'
    | 'too_many_files'
    | 'path_traversal'
    | 'empty_zip'
    | 'invalid_zip'
    | 'no_root_folder'

export class ZipValidationError extends Error {
  code: ZipValidationErrorCode
  constructor(code: ZipValidationErrorCode, message: string) {
    super(message)
    this.name = 'ZipValidationError'
    this.code = code
  }
}

export type ExtractedZipResult = {
  rootFolderName: string
  files: Map<string, Uint8Array>
}

const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

function isSystemEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/'))
    return true
  const basename = name.split('/').pop()!
  return SYSTEM_FILES.has(basename)
}

function hasUnsafePath(name: string): boolean {
  return name.split('/').some(s => s === '..' || s === '.')
}

export async function extractAndValidateZip(zipData: ArrayBuffer): Promise<ExtractedZipResult> {
  if (zipData.byteLength > MAX_ZIP_SIZE)
    throw new ZipValidationError('zip_too_large', `ZIP file exceeds ${MAX_ZIP_SIZE / 1024 / 1024}MB limit`)

  let filterError: ZipValidationError | null = null
  let fileCount = 0
  let estimatedSize = 0

  let raw: Record<string, Uint8Array>
  try {
    raw = await new Promise((resolve, reject) => {
      unzip(new Uint8Array(zipData), {
        filter(file) {
          if (file.name.endsWith('/'))
            return false

          if (isSystemEntry(file.name))
            return false

          if (hasUnsafePath(file.name)) {
            filterError ??= new ZipValidationError('path_traversal', `Unsafe path detected: ${file.name}`)
            return false
          }

          fileCount++
          if (fileCount > MAX_FILE_COUNT) {
            filterError ??= new ZipValidationError('too_many_files', `ZIP contains more than ${MAX_FILE_COUNT} files`)
            return false
          }

          estimatedSize += file.originalSize
          if (estimatedSize > MAX_EXTRACTED_SIZE) {
            filterError ??= new ZipValidationError('extracted_too_large', `Extracted content exceeds ${MAX_EXTRACTED_SIZE / 1024 / 1024}MB limit`)
            return false
          }

          return true
        },
      }, (err, result) => {
        if (err)
          reject(err)
        else
          resolve(result)
      })
    })
  }
  catch {
    throw filterError ?? new ZipValidationError('invalid_zip', 'Failed to decompress ZIP file')
  }

  if (filterError)
    throw filterError

  const files = new Map<string, Uint8Array>()
  let actualSize = 0
  for (const [path, data] of Object.entries(raw)) {
    actualSize += data.byteLength
    if (actualSize > MAX_EXTRACTED_SIZE)
      throw new ZipValidationError('extracted_too_large', `Extracted content exceeds ${MAX_EXTRACTED_SIZE / 1024 / 1024}MB limit`)
    files.set(path, data)
  }

  if (files.size === 0)
    throw new ZipValidationError('empty_zip', 'ZIP file contains no files')

  const rootFolders = new Set<string>()
  for (const path of files.keys())
    rootFolders.add(path.split('/')[0])

  if (rootFolders.size !== 1)
    throw new ZipValidationError('no_root_folder', 'ZIP must contain exactly one root folder')

  return { rootFolderName: [...rootFolders][0], files }
}
