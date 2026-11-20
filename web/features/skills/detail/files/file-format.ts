import type { SkillFileResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { getFileIconType } from '@/utils/file-icon'

const textMimeTypePrefixes = ['text/', 'application/json', 'application/javascript']

const textFileExtensions = [
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.md',
  '.py',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]

const codeEditorExtensions = new Map<string, CodeLanguage>([
  ['js', CodeLanguage.javascript],
  ['jsx', CodeLanguage.javascript],
  ['ts', CodeLanguage.javascript],
  ['tsx', CodeLanguage.javascript],
  ['json', CodeLanguage.json],
  ['py', CodeLanguage.python3],
  ['python', CodeLanguage.python3],
])

export function isDirectory(file: SkillFileResponse) {
  return file.kind === 'directory'
}

export function isTextFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (textMimeTypePrefixes.some((prefix) => mimeType.startsWith(prefix))) return true

  const lowerPath = file.path.toLowerCase()
  return textFileExtensions.some((extension) => lowerPath.endsWith(extension))
}

export function isMarkdownFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (mimeType === 'text/markdown') return true

  const lowerPath = file.path.toLowerCase()
  return lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')
}

export function isCsvFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (mimeType === 'text/csv' || mimeType === 'application/csv') return true

  return file.path.toLowerCase().endsWith('.csv')
}

export function getCreatedSkillFileMimeType(path: string) {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) return 'text/markdown'
  if (lowerPath.endsWith('.csv')) return 'text/csv'
  if (lowerPath.endsWith('.json')) return 'application/json'

  return 'text/plain'
}

export function parseCsvRows(content: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    const nextChar = content[index + 1]

    if (char === '"') {
      if (quoted && nextChar === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
      continue
    }

    if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && nextChar === '\n') index++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function getFileExtension(path: string) {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function getSkillFileIconType(file: SkillFileResponse) {
  return getFileIconType(file.path, file.mime_type)
}

export function getSkillFileIconClass(file: SkillFileResponse) {
  const iconType = getSkillFileIconType(file)

  if (iconType === 'folder') return 'i-ri-folder-5-line text-text-secondary'
  if (iconType === 'markdown') return 'i-ri-markdown-fill text-util-colors-blue-blue-600'
  if (iconType === 'json') return 'i-ri-braces-line text-util-colors-violet-violet-600'
  if (iconType === 'code') return 'i-ri-code-s-slash-line text-text-tertiary'
  if (iconType === 'image') return 'i-ri-image-line text-util-colors-green-green-600'
  if (iconType === 'pdf') return 'i-ri-file-pdf-2-line text-util-colors-red-red-600'
  if (iconType === 'table') return 'i-ri-table-line text-util-colors-green-green-600'
  if (iconType === 'archive') return 'i-ri-file-zip-line text-util-colors-warning-warning-600'
  if (iconType === 'text') return 'i-ri-file-text-line text-text-tertiary'

  return 'i-ri-file-line text-text-quaternary'
}

export function getSkillCodeLanguage(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return undefined

  return codeEditorExtensions.get(getFileExtension(file.path))
}

export function isSkillImageFile(file: SkillFileResponse) {
  return (file.mime_type ?? '').startsWith('image/') || getSkillFileIconType(file) === 'image'
}

export function isSkillPdfFile(file: SkillFileResponse) {
  return file.mime_type === 'application/pdf' || getSkillFileIconType(file) === 'pdf'
}
