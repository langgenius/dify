import type {
  ExternalAgentCapabilitiesResponse,
  ExternalInputFileTypeResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { asRecord } from '../../model'

const aliases: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'application/x-pdf': 'application/pdf',
  'text/x-markdown': 'text/markdown',
}
export type TestFileRules = {
  modes: string[]
  fileTypes: ExternalInputFileTypeResponse[]
  maxFiles: number
  maxDocumentBytes: number
  maxImageBytes: number
  maxTotalBytes: number
}
export function normalizeMime(value: string) {
  const mime = value.split(';')[0]!.trim().toLowerCase()
  return aliases[mime] ?? mime
}
function fileMimeFromName(name: string, fileTypes: readonly ExternalInputFileTypeResponse[]) {
  const type = fileTypes.find((type) =>
    type.extensions.some((extension) => name.toLowerCase().endsWith(extension.toLowerCase())),
  )
  return type ? normalizeMime(type.media_type) : ''
}
export function localFileMime(file: File, fileTypes: readonly ExternalInputFileTypeResponse[]) {
  if (file.type) return normalizeMime(file.type)
  return fileMimeFromName(file.name, fileTypes)
}
function accepts(modes: readonly string[], mime: string) {
  return modes.some((mode) => {
    const normalized = normalizeMime(mode)
    return normalized === mime || normalized === '*/*' || normalized === `${mime.split('/')[0]}/*`
  })
}
export function getTestFileRules(
  capabilities: ExternalAgentCapabilitiesResponse,
  inputModes: readonly string[],
): TestFileRules | null {
  const limits = asRecord(capabilities.limits.files)
  const maxFiles = limits.max_files
  const maxDocumentBytes = limits.max_document_bytes
  const maxImageBytes = limits.max_image_bytes
  const maxTotalBytes = limits.max_total_bytes
  if (
    [maxFiles, maxDocumentBytes, maxImageBytes, maxTotalBytes].some(
      (value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0,
    )
  )
    return null
  const fileTypes = capabilities.input_file_types.filter(({ media_type }) => {
    const mime = normalizeMime(media_type)
    return accepts(capabilities.input_file_modes, mime) && accepts(inputModes, mime)
  })
  return {
    modes: fileTypes.map(({ media_type }) => normalizeMime(media_type)),
    fileTypes,
    maxFiles: maxFiles as number,
    maxDocumentBytes: maxDocumentBytes as number,
    maxImageBytes: maxImageBytes as number,
    maxTotalBytes: maxTotalBytes as number,
  }
}
export function suggestedLinkFile(
  url: string,
  fileTypes: readonly ExternalInputFileTypeResponse[],
) {
  const parsed = URL.parse(url)
  let name = ''
  try {
    name = decodeURIComponent(parsed?.pathname.split('/').at(-1) ?? '')
  } catch {
    /* A malformed escape is not a filename. */
  }
  return { name, mime: fileMimeFromName(name, fileTypes) }
}
