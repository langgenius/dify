import type { ExternalAgentCapabilitiesResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { asRecord } from '../../model'

const aliases: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'application/x-pdf': 'application/pdf',
  'text/x-markdown': 'text/markdown',
}
const extensionMimeTypes: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}
export const fileMimeTypes = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
] as const
export type TestFileRules = {
  modes: string[]
  maxFiles: number
  maxDocumentBytes: number
  maxImageBytes: number
  maxTotalBytes: number
}
export function normalizeMime(value: string) {
  const mime = value.split(';')[0]!.trim().toLowerCase()
  return aliases[mime] ?? mime
}
export function localFileMime(file: File) {
  if (file.type) return normalizeMime(file.type)
  return extensionMimeTypes[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? ''
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
  return {
    modes: fileMimeTypes.filter(
      (mime) => accepts(capabilities.input_file_modes, mime) && accepts(inputModes, mime),
    ),
    maxFiles: maxFiles as number,
    maxDocumentBytes: maxDocumentBytes as number,
    maxImageBytes: maxImageBytes as number,
    maxTotalBytes: maxTotalBytes as number,
  }
}
export function suggestedLinkFile(url: string) {
  const parsed = URL.parse(url)
  let name = ''
  try {
    name = decodeURIComponent(parsed?.pathname.split('/').at(-1) ?? '')
  } catch {
    /* A malformed escape is not a filename. */
  }
  const extension = name.split('.').at(-1)?.toLowerCase()
  const mime = extensionMimeTypes[extension ?? ''] ?? ''
  return { name, mime }
}
