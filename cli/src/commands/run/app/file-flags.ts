import { basename } from 'node:path'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export type ParsedFileFlag
  = | { varname: string, kind: 'local', path: string }
    | { varname: string, kind: 'remote', url: string }

export function parseFileFlag(raw: string): ParsedFileFlag {
  const eqIdx = raw.indexOf('=')
  if (eqIdx === -1)
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--file must be key=@path or key=https://url' })

  const varname = raw.slice(0, eqIdx)
  const value = raw.slice(eqIdx + 1)

  if (varname === '')
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--file varname must not be empty' })

  if (value.startsWith('@'))
    return { varname, kind: 'local', path: value.slice(1) }

  if (value.startsWith('http://') || value.startsWith('https://'))
    return { varname, kind: 'remote', url: value }

  throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--file value must start with @ (local file) or http(s):// (remote URL)' })
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'])
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'amr', 'mpga'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mpeg', 'webm'])
// Matches graphon/file/constants.py DOCUMENT_EXTENSIONS (Unstructured ETL config)
const DOCUMENT_EXTS = new Set(['txt', 'markdown', 'md', 'mdx', 'pdf', 'html', 'htm', 'xlsx', 'xls', 'vtt', 'properties', 'doc', 'docx', 'csv', 'eml', 'msg', 'ppt', 'pptx', 'xml', 'epub'])

export type DifyFileType = 'image' | 'audio' | 'video' | 'document' | 'custom'

export function difyFileType(filename: string): DifyFileType {
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx <= 0 || dotIdx === filename.length - 1)
    return 'custom'
  const ext = filename.slice(dotIdx + 1).toLowerCase()
  if (IMAGE_EXTS.has(ext))
    return 'image'
  if (AUDIO_EXTS.has(ext))
    return 'audio'
  if (VIDEO_EXTS.has(ext))
    return 'video'
  if (DOCUMENT_EXTS.has(ext))
    return 'document'
  return 'document'
}

export type UploadCallback = (appId: string, path: string) => Promise<{ id: string }>

export async function resolveFileInputs(
  appId: string,
  rawFlags: readonly string[],
  upload: UploadCallback,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}

  for (const raw of rawFlags) {
    const parsed = parseFileFlag(raw)

    if (parsed.kind === 'remote') {
      const filename = new URL(parsed.url).pathname.split('/').pop() ?? ''
      result[parsed.varname] = {
        type: difyFileType(filename),
        transfer_method: 'remote_url',
        url: parsed.url,
      }
    }
    else {
      const filename = basename(parsed.path)
      let uploaded: { id: string }
      try {
        uploaded = await upload(appId, parsed.path)
      }
      catch (err) {
        throw new BaseError({ code: ErrorCode.Unknown, message: `--file ${parsed.varname}: upload of ${parsed.path} failed: ${(err as Error).message}`, cause: err })
      }
      result[parsed.varname] = {
        type: difyFileType(filename),
        transfer_method: 'local_file',
        upload_file_id: uploaded.id,
      }
    }
  }

  return result
}
