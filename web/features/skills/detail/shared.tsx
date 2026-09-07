'use client'

import type {
  SkillDetailResponse,
  SkillFileResponse,
  SkillResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { InfiniteData, useQueryClient } from '@tanstack/react-query'
import type {
  DefaultModel,
  FormValue,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { getFileIconType } from '@/features/agent-v2/agent-detail/configure/components/orchestrate/files/file-icon'
import { consoleClient, consoleQuery } from '@/service/client'
import {
  getSkillErrorCode,
  getSkillErrorDetailNumber,
  getSkillErrorDetailString,
  isSkillErrorRecord,
} from '../error'

export const isRecord = isSkillErrorRecord
export const getErrorCode = getSkillErrorCode
export const getErrorDetailNumber = getSkillErrorDetailNumber
export const getErrorDetailString = getSkillErrorDetailString

export const SKILL_TAG_CREATE_OPTION_PREFIX = '\u0000skill-tag-create:'

export type FileTreeNode = {
  children?: FileTreeNode[]
  file?: SkillFileResponse
  id: string
  name: string
  path: string
  type: 'directory' | 'file'
}

export type FileTreeInlineAction =
  | {
      kind: 'create'
      nodeType: 'directory' | 'file'
      parentPath?: string
    }
  | {
      kind: 'rename'
      nodeType: 'directory' | 'file'
      path: string
    }

export type SkillFileMutationCoordinator = {
  latestDetail: SkillDetailResponse | undefined
  queue: Promise<void>
  skillId: string
}

export function runSkillFileMutation(
  coordinator: SkillFileMutationCoordinator,
  mutation: (expectedUpdatedAt: number) => Promise<SkillDetailResponse>,
) {
  const operation = coordinator.queue.then(async () => {
    const latestDetail = coordinator.latestDetail
    if (!latestDetail) throw new Error('skill detail is required')

    const nextDetail = await mutation(latestDetail.updated_at)
    if (!coordinator.latestDetail || nextDetail.updated_at >= coordinator.latestDetail.updated_at)
      coordinator.latestDetail = nextDetail

    return nextDetail
  })
  coordinator.queue = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}

export const skillFileHotkeys = {
  copy: {
    command: 'Mod+C',
    keycaps: ['⌘', 'C'],
  },
  cut: {
    command: 'Mod+X',
    keycaps: ['⌘', 'X'],
  },
} as const

export const skillFileMenuPopupClassName = 'w-[168px] data-ending-style:transition-none'

export type SkillBuilderModel = DefaultModel & {
  model_settings?: FormValue
}

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

export const skillFileDragType = 'application/x-dify-skill-file-path'

export const skillFileDragPathsType = 'application/x-dify-skill-file-paths'

const codeEditorExtensions = new Map<string, CodeLanguage>([
  ['js', CodeLanguage.javascript],
  ['jsx', CodeLanguage.javascript],
  ['ts', CodeLanguage.javascript],
  ['tsx', CodeLanguage.javascript],
  ['json', CodeLanguage.json],
  ['py', CodeLanguage.python3],
  ['python', CodeLanguage.python3],
])

export const metadataKeyInputClassName =
  '[field-sizing:content] max-w-[calc(100%-28px)] min-w-0 rounded-[5px] border-0 bg-transparent px-1 py-0.5 system-sm-medium text-text-tertiary outline-hidden placeholder:text-text-quaternary hover:bg-state-base-hover focus:bg-components-input-bg-active focus:text-text-placeholder focus:shadow-xs focus:inset-ring-1 focus:inset-ring-components-input-border-active'

export const metadataValueInputClassName =
  'h-6 w-full rounded-md border-0 bg-transparent px-1 py-0.5 text-[14px]/5 text-text-primary outline-hidden placeholder:text-text-quaternary hover:bg-state-base-hover focus:bg-components-input-bg-active focus:shadow-xs focus:inset-ring-1 focus:inset-ring-components-input-border-active'

type MarkdownMetadataEntry = {
  key: string
  value: string
}

type ParsedMarkdownContent = {
  body: string
  description: string
  displayName: string
  metadata: MarkdownMetadataEntry[]
  name: string
}

export type BuilderChatMessage = {
  attachments?: SkillBuilderAttachment[]
  content: string
  id: string
  progressStages?: string[]
  rawContent?: string
  reasoningContent?: string
  role: 'assistant' | 'user'
  suggestedDisplayName?: string
  suggestedName?: string
  suggestions?: string[]
  thinkingDurationSeconds?: number
  tone?: 'error'
}

export type SkillBuilderAttachment = {
  id: string
  mimeType: string
  name: string
  previewUrl?: string
  size: number
  toolFileId: string
}

export const skillBuilderMaxAttachments = 10
export const skillBuilderMaxAttachmentBytes = 15 * 1024 * 1024
export const skillBuilderMaxImageAttachmentBytes = 10 * 1024 * 1024

export const skillBuilderAttachmentAccept = [
  'image/*',
  'text/*',
  'application/json',
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv',
  '.json',
  '.md',
  '.markdown',
  '.pdf',
  '.rtf',
  '.txt',
  '.xls',
  '.xlsx',
  '.yaml',
  '.yml',
].join(',')

const defaultSkillDescription = 'Describe what this Skill does and when an Agent should use it.'

const defaultSkillBody =
  '# Untitled skill\n\nDescribe what this Skill does, when an Agent should use it, and any step-by-step instructions it must follow.'

const untitledSkillDisplayName = 'Untitled skill'

const emptySkillDraftContentPlaceholder = '<!-- dify-skill-empty-draft -->'

function isLegacyUntitledSkillDraftContent(content: string) {
  const normalizedContent = content.replace(/\r\n?/g, '\n').trim()

  return (
    normalizedContent.startsWith('---\n') &&
    /\n---\n/.test(normalizedContent) &&
    /^name:\s*untitled-skill-[a-z0-9-]+\s*$/m.test(normalizedContent) &&
    new RegExp(
      `^description:\\s*${defaultSkillDescription.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
      'm',
    ).test(normalizedContent) &&
    /^# Untitled skill\s*$/m.test(normalizedContent) &&
    normalizedContent.includes(
      'Describe what this Skill does, when an Agent should use it, and any step-by-step instructions it must follow.',
    )
  )
}

export function normalizeSkillDraftContentForEditing(content: string) {
  if (content.trim() === emptySkillDraftContentPlaceholder) return ''
  if (isLegacyUntitledSkillDraftContent(content)) return ''

  return content
}

type SkillUploadStatus = 'failed' | 'saving' | 'uploaded' | 'uploading'

export type SkillUploadQueueItem = {
  error?: string
  failureKind?: 'conflict' | 'network'
  file: File
  id: string
  name: string
  path: string
  progress: number
  status: SkillUploadStatus
  suggestedPath?: string
}

export type SkillFileClipboard = {
  mode: 'copy' | 'cut'
  paths: string[]
}

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

export function isAllowedSkillBuilderAttachment(file: File) {
  const mimeType = file.type
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return false
  if (mimeType.startsWith('image/')) return true
  if (mimeType.startsWith('text/')) return true

  const allowedMimeTypes = new Set([
    'application/json',
    'application/pdf',
    'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ])
  if (allowedMimeTypes.has(mimeType)) return true

  const lowerName = file.name.toLowerCase()
  return [
    '.csv',
    '.gif',
    '.jpeg',
    '.jpg',
    '.json',
    '.md',
    '.markdown',
    '.pdf',
    '.png',
    '.rtf',
    '.svg',
    '.txt',
    '.xls',
    '.xlsx',
    '.yaml',
    '.yml',
    '.webp',
  ].some((extension) => lowerName.endsWith(extension))
}

export function isMarkdownFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (mimeType === 'text/markdown') return true

  const lowerPath = file.path.toLowerCase()
  return lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')
}

export function getSkillVersionTitle(version: SkillVersionResponse) {
  const versionName = version.version_name.trim()
  return versionName || `#${version.version_number}`
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

function unquoteYamlValue(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function isSimpleYamlKey(key: string) {
  if (!key) return false

  return [...key].every((char) => {
    const code = char.charCodeAt(0)
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      char === '_' ||
      char === '-'
    )
  })
}

function isDisplayNameMetadataKey(key: string) {
  return key === 'display-name' || key === 'display_name'
}

export function isProtectedMarkdownMetadataKey(key: string) {
  const trimmedKey = key.trim()
  return (
    trimmedKey === 'name' || trimmedKey === 'description' || isDisplayNameMetadataKey(trimmedKey)
  )
}

export function isEditableMetadataKey(key: string) {
  const trimmedKey = key.trim()
  if (!trimmedKey) return false

  return ![...trimmedKey].some((char) => char === ':' || char === '\n' || char === '\r')
}

export function parseMarkdownContent(content: string): ParsedMarkdownContent {
  const normalizedContent = normalizeSkillDraftContentForEditing(content)

  if (!normalizedContent.startsWith('---')) {
    return {
      body: normalizedContent,
      description: '',
      displayName: '',
      metadata: [],
      name: '',
    }
  }

  const lines = normalizedContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return {
      body: content,
      description: '',
      displayName: '',
      metadata: [],
      name: '',
    }
  }

  let name = ''
  let description = ''
  let displayName = ''
  const metadata: MarkdownMetadataEntry[] = []
  const frontmatterLines = lines.slice(1, closingIndex)
  let insideMetadata = false

  for (const line of frontmatterLines) {
    if (!line.trim()) continue

    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (!insideMetadata) continue

      const trimmedLine = line.trimStart()
      const separatorIndex = trimmedLine.indexOf(':')
      if (separatorIndex <= 0) continue

      const key = unquoteYamlValue(trimmedLine.slice(0, separatorIndex))
      const value = trimmedLine.slice(separatorIndex + 1).trimStart()
      if (isDisplayNameMetadataKey(key)) {
        displayName = unquoteYamlValue(value)
        continue
      }
      if (!isEditableMetadataKey(key) || isProtectedMarkdownMetadataKey(key)) continue

      if (!value) continue

      metadata.push({
        key,
        value: unquoteYamlValue(value),
      })
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex)
    if (!isSimpleYamlKey(key)) continue

    const value = line.slice(separatorIndex + 1).trimStart()
    insideMetadata = key === 'metadata' && !value
    if (key === 'name') {
      name = unquoteYamlValue(value)
      continue
    }
    if (key === 'description') {
      description = unquoteYamlValue(value)
      continue
    }
    if (!value) continue

    metadata.push({
      key,
      value: unquoteYamlValue(value),
    })
  }

  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .trimStart()

  return {
    body: normalizeSkillDraftContentForEditing(body),
    description,
    displayName,
    metadata,
    name,
  }
}

export function stripSkillFrontmatterForDisplay(content: string) {
  const normalizedContent = normalizeSkillDraftContentForEditing(content)
  if (!normalizedContent.startsWith('---')) return normalizedContent

  const lines = normalizedContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return normalizedContent

  const frontmatterLines = lines.slice(1, closingIndex)
  const hasSkillFrontmatter = frontmatterLines.some((line) => {
    const trimmedLine = line.trim()
    return (
      trimmedLine.startsWith('name:') ||
      trimmedLine.startsWith('description:') ||
      trimmedLine === 'metadata:'
    )
  })
  if (!hasSkillFrontmatter) return normalizedContent

  return lines
    .slice(closingIndex + 1)
    .join('\n')
    .trimStart()
}

function stringifyYamlValue(value: string) {
  if (!value.trim()) return ''

  const charactersRequiringQuotes = new Set([
    ':',
    '#',
    '[',
    ']',
    '{',
    '}',
    ',',
    '"',
    "'",
    '|',
    '>',
    '&',
    '*',
    '!',
    '%',
    '@',
    '`',
  ])
  if ([...value].some((char) => charactersRequiringQuotes.has(char)) || value !== value.trim()) {
    return JSON.stringify(value)
  }

  return value
}

function stringifyYamlKey(key: string) {
  const trimmedKey = key.trim()
  const firstCharCode = trimmedKey.charCodeAt(0)
  const startsWithSafeCharacter =
    (firstCharCode >= 65 && firstCharCode <= 90) ||
    (firstCharCode >= 97 && firstCharCode <= 122) ||
    trimmedKey.startsWith('_')
  const yamlBooleanLikeKeys = new Set([
    'false',
    'False',
    'FALSE',
    'null',
    'Null',
    'NULL',
    'true',
    'True',
    'TRUE',
    '~',
  ])
  if (
    startsWithSafeCharacter &&
    isSimpleYamlKey(trimmedKey) &&
    !yamlBooleanLikeKeys.has(trimmedKey)
  ) {
    return trimmedKey
  }

  return JSON.stringify(trimmedKey)
}

export function addMarkdownMetadata(content: string, key: string, value: string) {
  const normalizedContent = normalizeSkillDraftContentForEditing(content)
  const nextContent = removeMarkdownMetadata(normalizedContent, key)
  const metadataLine = `  ${stringifyYamlKey(key)}: ${stringifyYamlValue(value)}`

  if (!nextContent.startsWith('---')) {
    return `---\nmetadata:\n${metadataLine}\n---\n\n${nextContent}`
  }

  const lines = nextContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return `---\nmetadata:\n${metadataLine}\n---\n\n${normalizedContent}`
  }

  const metadataIndex = lines.findIndex(
    (line, index) => index > 0 && index < closingIndex && line.trim() === 'metadata:',
  )
  if (metadataIndex === -1) {
    return [
      ...lines.slice(0, closingIndex),
      'metadata:',
      metadataLine,
      ...lines.slice(closingIndex),
    ].join('\n')
  }

  let insertIndex = metadataIndex + 1
  while (insertIndex < closingIndex && /^\s+/.test(lines[insertIndex] ?? '')) {
    insertIndex += 1
  }

  return [...lines.slice(0, insertIndex), metadataLine, ...lines.slice(insertIndex)].join('\n')
}

export function updateMarkdownMetadata(
  content: string,
  previousKey: string,
  nextKey: string,
  value: string,
) {
  const trimmedPreviousKey = previousKey.trim()
  const trimmedNextKey = nextKey.trim()
  if (
    !isEditableMetadataKey(trimmedPreviousKey) ||
    !isEditableMetadataKey(trimmedNextKey) ||
    isProtectedMarkdownMetadataKey(trimmedPreviousKey) ||
    isProtectedMarkdownMetadataKey(trimmedNextKey)
  )
    return content

  return addMarkdownMetadata(
    removeMarkdownMetadata(content, trimmedPreviousKey),
    trimmedNextKey,
    value,
  )
}

export function setMarkdownFrontmatterField(
  content: string,
  key: 'description' | 'name',
  value: string,
) {
  const normalizedContent = normalizeSkillDraftContentForEditing(content)
  const fieldLine = `${key}: ${stringifyYamlValue(value)}`

  if (!normalizedContent.startsWith('---')) {
    return `---\n${fieldLine}\n---\n\n${normalizedContent}`
  }

  const lines = normalizedContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return `---\n${fieldLine}\n---\n\n${normalizedContent}`
  }

  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? ''
    if (line.startsWith(' ') || line.startsWith('\t')) continue

    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) continue

    if (line.slice(0, separatorIndex).trim() === key) {
      return [...lines.slice(0, index), fieldLine, ...lines.slice(index + 1)].join('\n')
    }
  }

  return [...lines.slice(0, closingIndex), fieldLine, ...lines.slice(closingIndex)].join('\n')
}

export function removeMarkdownMetadata(content: string, key: string) {
  const normalizedContent = normalizeSkillDraftContentForEditing(content)
  const trimmedKey = key.trim()
  if (!isEditableMetadataKey(trimmedKey) || isProtectedMarkdownMetadataKey(trimmedKey))
    return normalizedContent
  if (!normalizedContent.startsWith('---')) return normalizedContent

  const lines = normalizedContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return normalizedContent

  const removeLineIndexes = new Set<number>()
  let insideMetadata = false

  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? ''
    if (!line.trim()) continue

    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (!insideMetadata) continue

      const trimmedLine = line.trimStart()
      const separatorIndex = trimmedLine.indexOf(':')
      if (separatorIndex <= 0) continue

      const lineKey = unquoteYamlValue(trimmedLine.slice(0, separatorIndex))
      if (lineKey.trim() === trimmedKey) removeLineIndexes.add(index)
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      insideMetadata = false
      continue
    }

    const lineKey = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1).trimStart()
    insideMetadata = lineKey === 'metadata' && !value
    if (lineKey.trim() === trimmedKey) removeLineIndexes.add(index)
  }

  const nextLines = lines.filter((_, index) => !removeLineIndexes.has(index))
  const nextClosingIndex = nextLines.findIndex((line, index) => index > 0 && line.trim() === '---')
  const metadataIndex = nextLines.findIndex(
    (line, index) => index > 0 && index < nextClosingIndex && line.trim() === 'metadata:',
  )
  if (metadataIndex !== -1) {
    let hasMetadataChildren = false
    for (let index = metadataIndex + 1; index < nextClosingIndex; index += 1) {
      const line = nextLines[index] ?? ''
      if (!line.trim()) continue
      if (!line.startsWith(' ') && !line.startsWith('\t')) break
      hasMetadataChildren = true
      break
    }
    if (!hasMetadataChildren) nextLines.splice(metadataIndex, 1)
  }

  return nextLines.join('\n')
}

export function toFileTree(files: SkillFileResponse[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const folders = new Map<string, FileTreeNode>()

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let siblings = root
    let currentPath = ''

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLeaf = index === segments.length - 1
      const shouldCreateFolder = !isLeaf || isDirectory(file)

      if (shouldCreateFolder) {
        const existingFolder = folders.get(currentPath)
        if (existingFolder) {
          siblings = existingFolder.children ?? []
          return
        }

        const folder: FileTreeNode = {
          children: [],
          id: currentPath,
          name: segment,
          path: currentPath,
          type: 'directory',
        }
        folders.set(currentPath, folder)
        siblings.push(folder)
        siblings = folder.children ?? []
        return
      }

      siblings.push({
        file,
        id: file.path,
        name: segment,
        path: file.path,
        type: 'file',
      })
    })
  }

  return root
}

export function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenFileTree(node.children) : [])])
}

export function getFirstTextFile(files: SkillFileResponse[]) {
  return (
    files.find((file) => file.path === 'SKILL.md') ??
    files.find((file) => !isDirectory(file) && isTextFile(file)) ??
    files.find((file) => !isDirectory(file))
  )
}

export function findFileByPath(files: SkillFileResponse[], path: string | undefined) {
  if (!path) return undefined

  return files.find((file) => file.path === path)
}

export function getPathBaseName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function getCopyFileName(fileName: string, index: number) {
  const extensionIndex = fileName.lastIndexOf('.')
  const hasExtension = extensionIndex > 0
  const name = hasExtension ? fileName.slice(0, extensionIndex) : fileName
  const extension = hasExtension ? fileName.slice(extensionIndex) : ''
  const suffix = index === 1 ? ' copy' : ` copy ${index}`
  return `${name}${suffix}${extension}`
}

export function getCopyTargetPath(
  files: SkillFileResponse[],
  targetDirectory: string | undefined,
  sourcePath: string,
  pendingTargetPaths: string[],
) {
  const existingPaths = new Set([...files.map((file) => file.path), ...pendingTargetPaths])
  const fileName = getPathBaseName(sourcePath)
  const directTargetPath = joinSkillPath(targetDirectory, fileName)
  if (directTargetPath !== sourcePath && !existingPaths.has(directTargetPath))
    return directTargetPath

  for (let index = 1; index < 1000; index += 1) {
    const targetPath = joinSkillPath(targetDirectory, getCopyFileName(fileName, index))
    if (!existingPaths.has(targetPath)) return targetPath
  }

  return undefined
}

export function getReferenceTargets(files: SkillFileResponse[], currentPath: string | undefined) {
  const targetByPath = new Map<string, SkillFileResponse>()

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    for (let index = 1; index < segments.length; index += 1) {
      const directoryPath = segments.slice(0, index).join('/')
      if (!targetByPath.has(directoryPath)) {
        targetByPath.set(directoryPath, {
          kind: 'directory',
          path: directoryPath,
          size: 0,
        })
      }
    }

    if (file.path !== currentPath) targetByPath.set(file.path, file)
  }

  return [...targetByPath.values()].sort((left, right) => {
    if (isDirectory(left) !== isDirectory(right)) return isDirectory(left) ? -1 : 1
    return left.path.localeCompare(right.path)
  })
}

export function getReferenceText(file: SkillFileResponse) {
  return `[${getPathBaseName(file.path)}](<${file.path}>)`
}

export function getMarkdownBodyPrefix(content: string) {
  const normalizedContent = normalizeSkillDraftContentForEditing(content)
  if (!normalizedContent.startsWith('---')) return ''

  const lines = normalizedContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return ''

  return `${lines.slice(0, closingIndex + 1).join('\n')}\n\n`
}

export function replaceMarkdownBody(content: string, body: string) {
  return `${getMarkdownBodyPrefix(content)}${body}`
}

type MarkdownBodySegment =
  | {
      key: string
      text: string
      type: 'text'
    }
  | {
      key: string
      label: string
      path: string
      type: 'reference'
    }

function parseMarkdownBodyReferences(body: string): MarkdownBodySegment[] {
  const segments: MarkdownBodySegment[] = []
  const referencePattern = /\[([^\]]+)\]\(<([^>\n]+)>\)/g
  let lastIndex = 0

  for (const match of body.matchAll(referencePattern)) {
    if (match.index == null) continue
    if (match.index > lastIndex) {
      segments.push({
        key: `text:${lastIndex}`,
        type: 'text',
        text: body.slice(lastIndex, match.index),
      })
    }
    segments.push({
      key: `reference:${match.index}`,
      type: 'reference',
      label: (match[1] ?? '').replace(/\s+/g, ' '),
      path: match[2] ?? '',
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < body.length) {
    segments.push({
      key: `text:${lastIndex}`,
      type: 'text',
      text: body.slice(lastIndex),
    })
  }

  return segments
}

export function findMarkdownReferenceRangeAtCaret(body: string, caretIndex: number) {
  const referencePattern = /\[([^\]]+)\]\(<([^>\n]+)>\)/g

  for (const match of body.matchAll(referencePattern)) {
    if (match.index == null) continue

    const start = match.index
    const end = start + match[0].length
    if (caretIndex > start && caretIndex <= end) return { end, start }
  }
}

export function findBrokenMarkdownReferenceRangeAtCaret(body: string, caretIndex: number) {
  const lineStart = body.lastIndexOf('\n', Math.max(caretIndex - 1, 0)) + 1
  const lineEndIndex = body.indexOf('\n', caretIndex)
  const lineEnd = lineEndIndex === -1 ? body.length : lineEndIndex
  const lineBeforeCaret = body.slice(lineStart, caretIndex)
  const partialReferenceStart = lineBeforeCaret.search(/\[[^\]\n]*\]\(<[^>\n]*$/)

  if (partialReferenceStart === -1) return

  return {
    start: lineStart + partialReferenceStart,
    end: lineEnd,
  }
}

export function getReferenceIconClass(path: string) {
  if (!path.includes('.')) return 'i-ri-folder-5-line text-util-colors-blue-blue-600'

  return getSkillFileIconClass({
    kind: 'file',
    path,
  })
}

export function getReferenceDisplayLabel(path: string, label: string) {
  return label.trim() || getPathBaseName(path)
}

const markdownLiveBlockTags = new Set(['DIV', 'P'])

export function serializeMarkdownLiveEditorNode(node: Node, rootNode: Node = node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''

  if (node instanceof HTMLElement) {
    const referenceMarkdown = node.dataset.referenceMarkdown
    if (referenceMarkdown) return referenceMarkdown

    if (node.tagName === 'BR') return '\n'
  }

  const content = Array.from(node.childNodes)
    .map((childNode) => serializeMarkdownLiveEditorNode(childNode, rootNode))
    .join('')

  if (node !== rootNode && node instanceof HTMLElement && markdownLiveBlockTags.has(node.tagName))
    return content.endsWith('\n') ? content : `${content}\n`

  return content
}

export function renderMarkdownLiveEditorContent(root: HTMLDivElement, body: string) {
  root.replaceChildren()

  const segments = parseMarkdownBodyReferences(body)
  for (const segment of segments) {
    if (segment.type === 'text') {
      root.appendChild(root.ownerDocument.createTextNode(segment.text))
      continue
    }

    const markdown = `[${segment.label || getPathBaseName(segment.path)}](<${segment.path}>)`
    const referenceElement = root.ownerDocument.createElement('span')
    referenceElement.contentEditable = 'false'
    referenceElement.dataset.referenceMarkdown = markdown
    referenceElement.dataset.referencePath = segment.path
    referenceElement.className =
      'relative inline-flex cursor-pointer flex-col items-start px-0.5 py-px align-baseline outline-none focus-visible:rounded-[5px] focus-visible:ring-2 focus-visible:ring-state-accent-solid'
    referenceElement.tabIndex = 0
    referenceElement.setAttribute('role', 'button')

    const chipElement = root.ownerDocument.createElement('span')
    chipElement.className =
      'inline-flex min-w-[18px] items-center overflow-hidden rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover py-px pr-1 pl-px text-text-accent shadow-xs'

    const labelElement = root.ownerDocument.createElement('span')
    labelElement.className = 'inline-flex min-w-0 items-center gap-0.5'

    const iconWrapElement = root.ownerDocument.createElement('span')
    iconWrapElement.className = 'inline-flex shrink-0 items-center justify-center p-px'

    const iconElement = root.ownerDocument.createElement('span')
    iconElement.setAttribute('aria-hidden', 'true')
    iconElement.className = cn('size-3.5 shrink-0', getReferenceIconClass(segment.path))
    iconWrapElement.appendChild(iconElement)
    labelElement.appendChild(iconWrapElement)

    const textElement = root.ownerDocument.createElement('span')
    textElement.className = 'max-w-48 truncate system-xs-medium'
    textElement.textContent = getReferenceDisplayLabel(segment.path, segment.label)
    labelElement.appendChild(textElement)

    chipElement.appendChild(labelElement)
    referenceElement.appendChild(chipElement)

    root.appendChild(referenceElement)
  }
}

export function getMarkdownLiveEditorSelectionOffset(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  const prefixRange = range.cloneRange()
  prefixRange.selectNodeContents(root)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  return serializeMarkdownLiveEditorNode(prefixRange.cloneContents()).replace(/\u00A0/g, ' ').length
}

export function setMarkdownLiveEditorSelectionOffset(root: HTMLElement, offset: number) {
  const selection = root.ownerDocument.getSelection()
  if (!selection) return

  let remainingOffset = Math.max(offset, 0)
  let resolved = false

  const setRange = (node: Node, nodeOffset: number) => {
    const range = root.ownerDocument.createRange()
    range.setStart(node, nodeOffset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    resolved = true
  }

  const walk = (node: Node) => {
    if (resolved) return

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (remainingOffset <= length) {
        setRange(node, remainingOffset)
        return
      }
      remainingOffset -= length
      return
    }

    if (node instanceof HTMLElement) {
      const referenceMarkdown = node.dataset.referenceMarkdown
      if (referenceMarkdown) {
        const length = referenceMarkdown.length
        if (remainingOffset <= length) {
          const parent = node.parentNode
          if (!parent) return

          const nodeIndex = Array.from(parent.childNodes).indexOf(node)
          setRange(parent, nodeIndex + (remainingOffset === 0 ? 0 : 1))
          return
        }
        remainingOffset -= length
        return
      }

      if (node.tagName === 'BR') {
        if (remainingOffset <= 1) {
          const parent = node.parentNode
          if (!parent) return

          const nodeIndex = Array.from(parent.childNodes).indexOf(node)
          setRange(parent, nodeIndex + (remainingOffset === 0 ? 0 : 1))
          return
        }
        remainingOffset -= 1
        return
      }
    }

    for (const childNode of Array.from(node.childNodes)) walk(childNode)
  }

  walk(root)

  if (!resolved) setRange(root, root.childNodes.length)
}

export function insertMarkdownLiveEditorLineBreak(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  const currentOffset = getMarkdownLiveEditorSelectionOffset(root)
  if (currentOffset == null) return null

  range.deleteContents()
  range.insertNode(root.ownerDocument.createTextNode('\n'))
  setMarkdownLiveEditorSelectionOffset(root, currentOffset + 1)

  return currentOffset + 1
}

export function getContentEditableCaretAnchor(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return { x: 0, y: 0 }

  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(false)
  const rect = range.getBoundingClientRect()

  return {
    x: rect.left,
    y: rect.bottom,
  }
}

export function getTextareaCaretAnchor(textarea: HTMLTextAreaElement, index: number) {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const properties = [
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderTopWidth',
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'textTransform',
    'whiteSpace',
    'wordBreak',
    'wordSpacing',
  ] as const

  for (const property of properties) {
    mirror.style[property] = style[property]
  }

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.overflow = 'hidden'
  mirror.style.left = '-9999px'
  mirror.style.top = '0'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.height = 'auto'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'

  const before = textarea.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '\u200B'
  mirror.textContent = before
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const textareaRect = textarea.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  const anchor = {
    x: textareaRect.left - mirrorRect.left + markerRect.left - textarea.scrollLeft,
    y:
      textareaRect.top -
      mirrorRect.top +
      markerRect.top -
      textarea.scrollTop +
      markerRect.height +
      6,
  }

  mirror.remove()
  return anchor
}

export function getPathDirName(path: string) {
  const segments = path.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
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

export function isDefaultSkillBuilderDraft(detail: SkillDetailResponse) {
  const skillMd = findFileByPath(detail.files ?? [], 'SKILL.md')
  const skillMdContent =
    skillMd && isTextFile(skillMd) && skillMd.content ? parseMarkdownContent(skillMd.content) : null
  const description = detail.description.trim()
  const skillMdBody = skillMdContent?.body.trim() ?? ''

  return (
    detail.latest_published_version_id == null &&
    detail.name.startsWith('untitled-skill') &&
    detail.display_name === untitledSkillDisplayName &&
    (description === '' || description === defaultSkillDescription) &&
    (skillMdBody === '' || skillMdBody === defaultSkillBody)
  )
}

export function deriveSkillDetailFromDraftFiles(detail: SkillDetailResponse) {
  const skillMd = findFileByPath(detail.files ?? [], 'SKILL.md')
  if (!skillMd || !isTextFile(skillMd) || !skillMd.content) return detail

  const parsedSkillMd = parseMarkdownContent(skillMd.content)
  const shouldDeriveUntitledSkillName =
    detail.latest_published_version_id == null &&
    !detail.name_manually_edited &&
    detail.name.startsWith('untitled-skill') &&
    detail.display_name === untitledSkillDisplayName
  const derivedDisplayName = shouldDeriveUntitledSkillName
    ? getDraftSkillDisplayName(parsedSkillMd)
    : undefined
  const derivedName = derivedDisplayName
    ? getDraftSkillName(parsedSkillMd, derivedDisplayName)
    : undefined

  return {
    ...detail,
    description: parsedSkillMd.description || detail.description,
    ...(derivedDisplayName ? { display_name: derivedDisplayName } : {}),
    ...(derivedName ? { name: derivedName } : {}),
  }
}

function getDraftSkillDisplayName(parsedSkillMd: ParsedMarkdownContent) {
  if (parsedSkillMd.displayName && parsedSkillMd.displayName !== untitledSkillDisplayName)
    return parsedSkillMd.displayName

  const headingLine = parsedSkillMd.body
    .split('\n')
    .find((line) => line.startsWith('# ') && line.slice(2).trim())
  const heading = headingLine?.slice(2).trim()
  if (!heading || heading === untitledSkillDisplayName) return undefined

  return heading
}

function getDraftSkillName(parsedSkillMd: ParsedMarkdownContent, displayName: string) {
  if (parsedSkillMd.name && !parsedSkillMd.name.startsWith('untitled-skill'))
    return parsedSkillMd.name

  const generatedName = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return generatedName || undefined
}

function parseServerMessage(message: string) {
  const trimmedMessage = message.trim()
  if (!trimmedMessage.startsWith('{')) return trimmedMessage

  try {
    const parsed: unknown = JSON.parse(trimmedMessage)
    if (parsed && typeof parsed === 'object') {
      const parsedMessage = (parsed as Record<string, unknown>).message
      if (typeof parsedMessage === 'string' && parsedMessage.trim()) return parsedMessage.trim()
    }
  } catch {
    return trimmedMessage
  }

  return trimmedMessage
}

async function readSkillResponseErrorMessage(response: Response) {
  try {
    const data: unknown = await response.clone().json()
    return getSkillErrorMessage(data)
  } catch {
    try {
      const text = await response.clone().text()
      if (text.trim()) return parseServerMessage(text)
    } catch {}
  }
}

async function readSkillResponseErrorPayload(response: Response) {
  try {
    const data: unknown = await response.clone().json()
    return isRecord(data) ? data : undefined
  } catch {
    return undefined
  }
}

function getSkillErrorMessage(error: unknown, visited = new Set<unknown>()): string | undefined {
  if (error instanceof Response) return undefined
  if (!error || visited.has(error)) return undefined
  if (typeof error === 'string') return parseServerMessage(error)
  if (typeof error !== 'object') return undefined

  visited.add(error)
  const record = error as Record<string, unknown>

  for (const key of ['data', 'body', 'error', 'cause', 'response']) {
    const nestedMessage = getSkillErrorMessage(record[key], visited)
    if (nestedMessage) return nestedMessage
  }

  const message = record.message
  if (typeof message === 'string' && message.trim()) return parseServerMessage(message)

  return undefined
}

export async function getAsyncSkillErrorMessage(error: unknown) {
  if (error instanceof Response) return readSkillResponseErrorMessage(error)

  return getSkillErrorMessage(error)
}

export async function getAsyncSkillErrorPayload(error: unknown) {
  if (error instanceof Response) return readSkillResponseErrorPayload(error)

  return isRecord(error) ? error : undefined
}

export function showSkillErrorToast(error: unknown, fallbackMessage: string) {
  void showSkillErrorToastAsync(error, fallbackMessage)
}

async function showSkillErrorToastAsync(error: unknown, fallbackMessage: string) {
  toast.error((await getAsyncSkillErrorMessage(error)) ?? fallbackMessage)
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

export function isNestedPath(parentPath: string, childPath: string) {
  return childPath.startsWith(`${parentPath}/`)
}

export function getDraggedSkillPaths(dataTransfer: DataTransfer) {
  const rawPaths = dataTransfer.getData(skillFileDragPathsType)
  if (rawPaths) {
    try {
      const parsedPaths: unknown = JSON.parse(rawPaths)
      if (Array.isArray(parsedPaths))
        return parsedPaths.filter((path): path is string => typeof path === 'string' && !!path)
    } catch {
      return []
    }
  }

  const sourcePath = dataTransfer.getData(skillFileDragType)
  return sourcePath ? [sourcePath] : []
}

export function invalidateSkillDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  skillId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.bySkillId.get.key({
      type: 'query',
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
      type: 'query',
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({ type: 'query' }),
  })
}

export function setSkillDetailCache(
  queryClient: ReturnType<typeof useQueryClient>,
  skillId: string,
  detail: SkillDetailResponse,
) {
  queryClient.setQueryData(
    consoleQuery.workspaces.current.skills.bySkillId.get.key({
      type: 'query',
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
    detail,
  )
  updateSkillListCache(queryClient, detail)
}

type SkillListCachePage = {
  data?: SkillResponse[]
}

function updateSkillListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  detail: SkillDetailResponse,
) {
  const updateSkill = (skill: SkillResponse): SkillResponse => {
    if (skill.id !== detail.id) return skill

    return {
      ...skill,
      description: detail.description,
      display_name: detail.display_name,
      icon: detail.icon,
      latest_published_at: detail.latest_published_at,
      latest_published_version_id: detail.latest_published_version_id,
      latest_published_version_number: detail.latest_published_version_number,
      name: detail.name,
      name_manually_edited: detail.name_manually_edited,
      reference_count: detail.reference_count,
      tags: detail.tags,
      updated_at: detail.updated_at,
      updated_by: detail.updated_by,
      updated_by_name: detail.updated_by_name,
    }
  }
  const updatePage = <TPage extends SkillListCachePage>(page: TPage): TPage => {
    if (!page.data?.some((skill) => skill.id === detail.id)) return page

    return {
      ...page,
      data: page.data.map(updateSkill),
    }
  }

  queryClient.setQueriesData<SkillListCachePage>(
    {
      queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
    },
    (page) => (page ? updatePage(page) : page),
  )
  queryClient.setQueriesData<InfiniteData<SkillListCachePage>>(
    {
      queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
    },
    (cache) =>
      cache
        ? {
            ...cache,
            pages: cache.pages.map(updatePage),
          }
        : cache,
  )
}

function refetchSkillDetail(skillId: string) {
  return consoleClient.workspaces.current.skills.bySkillId.get({
    params: {
      skill_id: skillId,
    },
  })
}

export async function refreshSkillDetailAfterConflict(
  queryClient: ReturnType<typeof useQueryClient>,
  skillId: string,
  options: { updateCache?: boolean } = {},
) {
  const detail = await refetchSkillDetail(skillId)
  if (options.updateCache !== false) setSkillDetailCache(queryClient, skillId, detail)
  return detail
}

export function joinSkillPath(basePath: string | undefined, name: string) {
  const normalizedBase = (basePath ?? '').replace(/^\/+|\/+$/g, '')
  const normalizedName = name.replace(/^\/+/g, '')
  return normalizedBase ? `${normalizedBase}/${normalizedName}` : normalizedName
}

export function getUploadPath(file: File, basePath?: string) {
  return joinSkillPath(basePath, file.webkitRelativePath || file.name)
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]')) ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}

export function createUploadItemId(file: File, index: number) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `${file.name}-${file.size}-${file.lastModified}-${index}`
}

export function getUploadFileName(file: File) {
  return file.webkitRelativePath || file.name
}
