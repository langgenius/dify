'use client'

/* oxlint-disable eslint-react/set-state-in-effect -- The Skill editor intentionally mirrors the selected file snapshot into local editable draft state. */

import type {
  SkillDetailResponse,
  SkillFileResponse,
  SkillReferenceResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  ChangeEvent,
  DragEvent,
  FocusEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react'
import type {
  DefaultModel,
  FormValue,
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AppIconType } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import copy from 'copy-to-clipboard'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { Markdown } from '@/app/components/base/markdown'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { getFileIconType } from '@/features/agent-v2/agent-detail/configure/components/orchestrate/files/file-icon'
import useDocumentTitle from '@/hooks/use-document-title'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { fetchSkillFileBlob, sendSkillAssistMessage, uploadSkillFile } from './client'

type FileTreeNode = {
  children?: FileTreeNode[]
  file?: SkillFileResponse
  id: string
  name: string
  path: string
  type: 'directory' | 'file'
}

type SkillBuilderModel = DefaultModel & {
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
const skillFileDragType = 'application/x-dify-skill-file-path'
const skillFileDragPathsType = 'application/x-dify-skill-file-paths'
const codeEditorExtensions = new Map<string, CodeLanguage>([
  ['js', CodeLanguage.javascript],
  ['jsx', CodeLanguage.javascript],
  ['ts', CodeLanguage.javascript],
  ['tsx', CodeLanguage.javascript],
  ['json', CodeLanguage.json],
  ['py', CodeLanguage.python3],
  ['python', CodeLanguage.python3],
])
const metadataInputClassName =
  'h-8 w-full rounded-lg border border-divider-regular bg-background-default px-2.5 system-sm-regular text-text-secondary outline-hidden placeholder:text-text-quaternary focus-visible:ring-2 focus-visible:ring-state-accent-solid'

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

type BuilderChatMessage = {
  content: string
  id: string
  role: 'assistant' | 'user'
}

type SkillBuilderAttachment = {
  id: string
  mimeType: string
  name: string
  size: number
  toolFileId: string
}

const skillBuilderAttachmentAccept = [
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

type SkillUploadStatus = 'failed' | 'saving' | 'uploaded' | 'uploading'

type SkillUploadQueueItem = {
  error?: string
  id: string
  name: string
  progress: number
  status: SkillUploadStatus
}

type SkillFileClipboard = {
  mode: 'copy' | 'cut'
  paths: string[]
}

function isDirectory(file: SkillFileResponse) {
  return file.kind === 'directory'
}

function isTextFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (textMimeTypePrefixes.some((prefix) => mimeType.startsWith(prefix))) return true

  const lowerPath = file.path.toLowerCase()
  return textFileExtensions.some((extension) => lowerPath.endsWith(extension))
}

function isAllowedSkillBuilderAttachment(file: File) {
  const mimeType = file.type
  if (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  )
    return false
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
  ].some((extension) => lowerName.endsWith(extension))
}

function isMarkdownFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (mimeType === 'text/markdown') return true

  const lowerPath = file.path.toLowerCase()
  return lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')
}

function isCsvFile(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return false

  const mimeType = file.mime_type ?? ''
  if (mimeType === 'text/csv' || mimeType === 'application/csv') return true

  return file.path.toLowerCase().endsWith('.csv')
}

function parseCsvRows(content: string) {
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

function isProtectedMarkdownMetadataKey(key: string) {
  const trimmedKey = key.trim()
  return (
    trimmedKey === 'name' || trimmedKey === 'description' || isDisplayNameMetadataKey(trimmedKey)
  )
}

function isEditableMetadataKey(key: string) {
  const trimmedKey = key.trim()
  if (!trimmedKey) return false

  return ![...trimmedKey].some((char) => char === ':' || char === '\n' || char === '\r')
}

function parseMarkdownContent(content: string): ParsedMarkdownContent {
  if (!content.startsWith('---')) {
    return {
      body: content,
      description: '',
      displayName: '',
      metadata: [],
      name: '',
    }
  }

  const lines = content.split(/\r?\n/)
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

  return {
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .trimStart(),
    description,
    displayName,
    metadata,
    name,
  }
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

function addMarkdownMetadata(content: string, key: string, value: string) {
  const nextContent = removeMarkdownMetadata(content, key)
  const metadataLine = `  ${stringifyYamlKey(key)}: ${stringifyYamlValue(value)}`

  if (!nextContent.startsWith('---')) {
    return `---\nmetadata:\n${metadataLine}\n---\n\n${nextContent}`
  }

  const lines = nextContent.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return `---\nmetadata:\n${metadataLine}\n---\n\n${content}`
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

function setMarkdownDisplayName(content: string, value: string) {
  const nextContent = removeMarkdownDisplayName(content)
  if (!value.trim()) return nextContent

  return addMarkdownMetadata(nextContent, 'display-name', value)
}

function removeMarkdownMetadata(content: string, key: string) {
  const trimmedKey = key.trim()
  if (!isEditableMetadataKey(trimmedKey) || isProtectedMarkdownMetadataKey(trimmedKey))
    return content
  if (!content.startsWith('---')) return content

  const lines = content.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return content

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

function removeMarkdownDisplayName(content: string) {
  if (!content.startsWith('---')) return content

  const lines = content.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return content

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
      if (isDisplayNameMetadataKey(lineKey.trim())) removeLineIndexes.add(index)
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

function sortFileNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1

      return left.name.localeCompare(right.name)
    })
    .map((node) => (node.children ? { ...node, children: sortFileNodes(node.children) } : node))
}

function toFileTree(files: SkillFileResponse[]): FileTreeNode[] {
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

  return sortFileNodes(root)
}

function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenFileTree(node.children) : [])])
}

function getFirstTextFile(files: SkillFileResponse[]) {
  return (
    files.find((file) => file.path === 'SKILL.md') ??
    files.find((file) => !isDirectory(file) && isTextFile(file)) ??
    files.find((file) => !isDirectory(file))
  )
}

function findFileByPath(files: SkillFileResponse[], path: string | undefined) {
  if (!path) return undefined

  return files.find((file) => file.path === path)
}

function getPathBaseName(path: string) {
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

function getCopyTargetPath(
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

function getReferenceTargets(files: SkillFileResponse[], currentPath: string | undefined) {
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

function getReferenceText(file: SkillFileResponse) {
  return `[${getPathBaseName(file.path)}](<${file.path}>)`
}

function getMarkdownBodyPrefix(content: string) {
  if (!content.startsWith('---')) return ''

  const lines = content.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return ''

  return `${lines.slice(0, closingIndex + 1).join('\n')}\n\n`
}

function replaceMarkdownBody(content: string, body: string) {
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

function findMarkdownReferenceRangeAtCaret(body: string, caretIndex: number) {
  const referencePattern = /\[([^\]]+)\]\(<([^>\n]+)>\)/g

  for (const match of body.matchAll(referencePattern)) {
    if (match.index == null) continue

    const start = match.index
    const end = start + match[0].length
    if (caretIndex > start && caretIndex <= end) return { end, start }
  }
}

function findBrokenMarkdownReferenceRangeAtCaret(body: string, caretIndex: number) {
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

function getReferenceIconClass(path: string) {
  if (!path.includes('.')) return 'i-ri-folder-5-line text-util-colors-blue-blue-600'

  return getSkillFileIconClass({
    kind: 'file',
    path,
  })
}

function getReferencePathSegments(path: string, fallbackLabel: string) {
  const segments = path.split('/').filter(Boolean)
  return segments.length > 0 ? segments : [fallbackLabel]
}

function serializeMarkdownLiveEditorNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''

  if (node instanceof HTMLElement) {
    const referenceMarkdown = node.dataset.referenceMarkdown
    if (referenceMarkdown) return referenceMarkdown

    if (node.tagName === 'BR') return '\n'
  }

  return Array.from(node.childNodes).map(serializeMarkdownLiveEditorNode).join('')
}

function renderMarkdownLiveEditorContent(root: HTMLDivElement, body: string) {
  root.replaceChildren()

  const segments = parseMarkdownBodyReferences(body)
  for (const segment of segments) {
    if (segment.type === 'text') {
      root.appendChild(root.ownerDocument.createTextNode(segment.text))
      continue
    }

    const pathSegments = getReferencePathSegments(segment.path, segment.label)
    const markdown = `[${segment.label || getPathBaseName(segment.path)}](<${segment.path}>)`
    const referenceElement = root.ownerDocument.createElement('span')
    referenceElement.contentEditable = 'false'
    referenceElement.dataset.referenceMarkdown = markdown
    referenceElement.className = 'mx-0.5 inline-flex translate-y-1 items-center gap-0.5'
    referenceElement.title = segment.path

    pathSegments.forEach((pathSegment, segmentIndex) => {
      const partialPath = pathSegments.slice(0, segmentIndex + 1).join('/')
      const isLastSegment = segmentIndex === pathSegments.length - 1
      const chipElement = root.ownerDocument.createElement('span')
      chipElement.className =
        'inline-flex h-6 items-center gap-1 rounded-md border border-util-colors-blue-blue-300 bg-util-colors-blue-blue-100 px-1.5 text-util-colors-blue-blue-700'

      const iconElement = root.ownerDocument.createElement('span')
      iconElement.setAttribute('aria-hidden', 'true')
      iconElement.className = cn(
        'size-4 shrink-0',
        isLastSegment
          ? getReferenceIconClass(segment.path)
          : 'i-ri-folder-5-line text-util-colors-blue-blue-600',
      )
      chipElement.appendChild(iconElement)

      const labelElement = root.ownerDocument.createElement('span')
      labelElement.className = 'max-w-48 truncate'
      labelElement.textContent = pathSegment || partialPath
      chipElement.appendChild(labelElement)

      referenceElement.appendChild(chipElement)
    })

    root.appendChild(referenceElement)
  }
}

function getMarkdownLiveEditorSelectionOffset(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  const prefixRange = range.cloneRange()
  prefixRange.selectNodeContents(root)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  return serializeMarkdownLiveEditorNode(prefixRange.cloneContents()).replace(/\u00A0/g, ' ').length
}

function setMarkdownLiveEditorSelectionOffset(root: HTMLElement, offset: number) {
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

function getContentEditableCaretAnchor(root: HTMLElement) {
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

function getTextareaCaretAnchor(textarea: HTMLTextAreaElement, index: number) {
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

function getPathDirName(path: string) {
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

function getSkillFileIconClass(file: SkillFileResponse) {
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

async function getAsyncSkillErrorMessage(error: unknown) {
  if (error instanceof Response) return readSkillResponseErrorMessage(error)

  return getSkillErrorMessage(error)
}

function showSkillErrorToast(error: unknown, fallbackMessage: string) {
  void showSkillErrorToastAsync(error, fallbackMessage)
}

async function showSkillErrorToastAsync(error: unknown, fallbackMessage: string) {
  toast.error((await getAsyncSkillErrorMessage(error)) ?? fallbackMessage)
}

function getSkillCodeLanguage(file: SkillFileResponse | undefined) {
  if (!file || isDirectory(file)) return undefined

  return codeEditorExtensions.get(getFileExtension(file.path))
}

function isSkillImageFile(file: SkillFileResponse) {
  return (file.mime_type ?? '').startsWith('image/') || getSkillFileIconType(file) === 'image'
}

function isSkillPdfFile(file: SkillFileResponse) {
  return file.mime_type === 'application/pdf' || getSkillFileIconType(file) === 'pdf'
}

function isNestedPath(parentPath: string, childPath: string) {
  return childPath.startsWith(`${parentPath}/`)
}

function getDraggedSkillPaths(dataTransfer: DataTransfer) {
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

function invalidateSkillDetail(queryClient: ReturnType<typeof useQueryClient>, skillId: string) {
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
}

function setSkillDetailCache(
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
}

function joinSkillPath(basePath: string | undefined, name: string) {
  const normalizedBase = (basePath ?? '').replace(/^\/+|\/+$/g, '')
  const normalizedName = name.replace(/^\/+/g, '')
  return normalizedBase ? `${normalizedBase}/${normalizedName}` : normalizedName
}

function getUploadPath(file: File, basePath?: string) {
  return joinSkillPath(basePath, file.webkitRelativePath || file.name)
}

function isEditableKeyboardTarget(target: EventTarget | null) {
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

function createUploadItemId(file: File, index: number) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `${file.name}-${file.size}-${file.lastModified}-${index}`
}

function getUploadFileName(file: File) {
  return file.webkitRelativePath || file.name
}

function SkillFilePathDialog({
  defaultPath,
  description,
  loading,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  defaultPath: string
  description: string
  loading: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (path: string) => void
  open: boolean
  title: string
}) {
  const { t: tCommon } = useTranslation('common')
  const [path, setPath] = useState(defaultPath)
  const trimmedPath = path.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] p-0!">
        <DialogCloseButton />
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
          <DialogDescription className="mt-2 system-sm-regular text-text-tertiary">
            {description}
          </DialogDescription>
        </div>
        <div className="px-6 py-3">
          <Input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmedPath) onSubmit(trimmedPath)
            }}
          />
        </div>
        <div className="flex justify-end gap-2 px-6 pt-3 pb-6">
          <Button disabled={loading} onClick={() => onOpenChange(false)}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={!trimmedPath}
            onClick={() => onSubmit(trimmedPath)}
          >
            {tCommon(($) => $['operation.save'])}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FileActions({
  detail,
  visible,
  node,
  onCopy,
  onCut,
  onUploadFiles,
  onSelect,
  skillId,
}: {
  detail: SkillDetailResponse
  visible: boolean
  node: FileTreeNode
  onCopy: (path: string) => void
  onCut: (path: string) => void
  onUploadFiles: (files: File[], targetDirectory: string | undefined) => void
  onSelect: (path: string) => void
  skillId: string
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [createFileOpen, setCreateFileOpen] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const fileMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const isDirectoryNode = node.type === 'directory'

  const mutateFile = (
    body: Parameters<typeof fileMutation.mutate>[0]['body'],
    options: {
      onSuccess?: () => void
      successMessage: string
    },
  ) => {
    fileMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {
          ...body,
          expected_updated_at: detail.updated_at,
        },
      },
      {
        onSuccess: (nextDetail) => {
          toast.success(options.successMessage)
          setSkillDetailCache(queryClient, skillId, nextDetail)
          invalidateSkillDetail(queryClient, skillId)
          options.onSuccess?.()
        },
        onError: (error) => {
          showSkillErrorToast(
            error,
            t(($) => $['skillManagement.detail.fileOperationFailed']),
          )
        },
      },
    )
  }

  const handleRename = (targetPath: string) => {
    mutateFile(
      {
        operation: 'rename',
        path: node.path,
        target_path: targetPath,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.renameFileSuccess']),
        onSuccess: () => {
          setRenameOpen(false)
          onSelect(targetPath)
        },
      },
    )
  }

  const handleCreateFile = (path: string) => {
    mutateFile(
      {
        content: '',
        mime_type: 'text/markdown',
        operation: 'upsert_text',
        path,
        size: 0,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.createFileSuccess']),
        onSuccess: () => {
          setCreateFileOpen(false)
          onSelect(path)
        },
      },
    )
  }

  const handleCreateFolder = (path: string) => {
    mutateFile(
      {
        operation: 'mkdir',
        path,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.createFolderSuccess']),
        onSuccess: () => {
          setCreateFolderOpen(false)
        },
      },
    )
  }

  const handleDelete = () => {
    mutateFile(
      {
        operation: 'delete',
        path: node.path,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.deleteFileSuccess']),
        onSuccess: () => {
          setDeleteOpen(false)
        },
      },
    )
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={tCommon(($) => $['operation.more'])}
          className={cn(
            'relative z-10 size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:flex data-popup-open:bg-state-base-hover',
            visible ? 'flex' : 'hidden group-hover:flex',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" popupClassName="w-44">
          {!isDirectoryNode && (
            <>
              <DropdownMenuItem
                className="gap-2"
                onClick={(event) => {
                  event.stopPropagation()
                  onCut(node.path)
                }}
              >
                <span aria-hidden className="i-ri-scissors-cut-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.cutFile'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onClick={(event) => {
                  event.stopPropagation()
                  onCopy(node.path)
                }}
              >
                <span aria-hidden className="i-ri-file-copy-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.copyFile'])}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {isDirectoryNode && (
            <>
              <DropdownMenuItem
                className="gap-2"
                onClick={(event) => {
                  event.stopPropagation()
                  setCreateFileOpen(true)
                }}
              >
                <span aria-hidden className="i-ri-file-add-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.createFile'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onClick={(event) => {
                  event.stopPropagation()
                  setCreateFolderOpen(true)
                }}
              >
                <span aria-hidden className="i-ri-folder-add-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.createFolder'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onClick={(event) => {
                  event.stopPropagation()
                  uploadInputRef.current?.click()
                }}
              >
                <span aria-hidden className="i-ri-upload-cloud-2-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.uploadFile'])}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              setRenameOpen(true)
            }}
          >
            <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
            <span>{tCommon(($) => $['operation.rename'])}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="gap-2"
            onClick={(event) => {
              event.stopPropagation()
              setDeleteOpen(true)
            }}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
            <span>{tCommon(($) => $['operation.delete'])}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onUploadFiles(Array.from(event.target.files ?? []), node.path)
          event.target.value = ''
        }}
      />
      <SkillFilePathDialog
        open={createFileOpen}
        onOpenChange={setCreateFileOpen}
        defaultPath={joinSkillPath(node.path, 'new-file.md')}
        title={t(($) => $['skillManagement.detail.createFile'])}
        description={t(($) => $['skillManagement.detail.createFileDescription'])}
        loading={fileMutation.isPending}
        onSubmit={handleCreateFile}
      />
      <SkillFilePathDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        defaultPath={joinSkillPath(node.path, 'new-folder')}
        title={t(($) => $['skillManagement.detail.createFolder'])}
        description={t(($) => $['skillManagement.detail.createFolderDescription'])}
        loading={fileMutation.isPending}
        onSubmit={handleCreateFolder}
      />
      <SkillFilePathDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        defaultPath={node.path}
        title={t(($) => $['skillManagement.detail.renameFile'])}
        description={t(($) => $['skillManagement.detail.renameFileDescription'])}
        loading={fileMutation.isPending}
        onSubmit={handleRename}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="p-6">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['skillManagement.detail.deleteFileConfirm'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 system-md-regular text-text-tertiary">
            {node.path}
          </AlertDialogDescription>
          <AlertDialogActions className="p-0 pt-6">
            <AlertDialogCancelButton disabled={fileMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={fileMutation.isPending}
              onClick={handleDelete}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function FileTreeItem({
  detail,
  draggingPath,
  dropTargetPath,
  node,
  onDropFiles,
  onCopy,
  onCut,
  onItemSelect,
  onMove,
  onSelect,
  onSetDraggingPath,
  onSetDropTarget,
  onUploadFiles,
  readonly,
  selectedPaths,
  selectedPath,
  skillId,
}: {
  detail: SkillDetailResponse | undefined
  draggingPath: string | undefined
  dropTargetPath: string | undefined
  node: FileTreeNode
  onDropFiles: (files: File[], targetDirectory: string | undefined) => void
  onCopy: (path: string) => void
  onCut: (path: string) => void
  onItemSelect: (node: FileTreeNode, event: MouseEvent<HTMLElement>) => void
  onMove: (sourcePaths: string[], targetDirectory: string | undefined) => void
  onSelect: (path: string) => void
  onSetDraggingPath: (path: string | undefined) => void
  onSetDropTarget: (path: string | undefined) => void
  onUploadFiles: (files: File[], targetDirectory: string | undefined) => void
  readonly: boolean
  selectedPaths: string[]
  selectedPath: string | undefined
  skillId: string
}) {
  const isDragging = draggingPath === node.path
  const nodeDropTargetPath = node.type === 'directory' ? node.path : getPathDirName(node.path)
  const isDropTarget = dropTargetPath === nodeDropTargetPath
  const isSelected = selectedPaths.includes(node.path)
  const actionsVisible = isSelected || selectedPath === node.path

  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    if (readonly) {
      event.preventDefault()
      return
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(skillFileDragType, node.path)
    event.dataTransfer.setData(
      skillFileDragPathsType,
      JSON.stringify(isSelected ? selectedPaths : [node.path]),
    )
    onSetDraggingPath(node.path)
  }

  const handleDragEnd = () => {
    onSetDraggingPath(undefined)
    onSetDropTarget(undefined)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes('Files')
      ? 'copy'
      : 'move'
    onSetDropTarget(nodeDropTargetPath)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (readonly) return
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return

    onSetDropTarget(undefined)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    event.stopPropagation()
    onSetDropTarget(undefined)

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) {
      onDropFiles(droppedFiles, nodeDropTargetPath || undefined)
      return
    }

    const sourcePaths = getDraggedSkillPaths(event.dataTransfer)
    if (sourcePaths.length > 0) onMove(sourcePaths, nodeDropTargetPath || undefined)
  }

  const nameNode = (
    <Tooltip>
      <TooltipTrigger render={<span className="w-0 min-w-0 flex-1 truncate">{node.name}</span>} />
      <TooltipContent placement="right" sideOffset={6}>
        <span className="whitespace-nowrap text-text-secondary">{node.path}</span>
      </TooltipContent>
    </Tooltip>
  )

  if (node.type === 'directory') {
    return (
      <li
        className="min-w-0"
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div
          data-skill-file-tree-item
          draggable={!readonly}
          className={cn(
            'group flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-2 system-xs-regular text-text-secondary outline-hidden transition-colors hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            isDropTarget && 'bg-state-accent-hover ring-1 ring-state-accent-solid',
            isSelected && 'bg-state-accent-hover text-text-accent',
            isDragging && 'opacity-50',
          )}
          role="button"
          tabIndex={0}
          title={node.path}
          onClick={(event) => onItemSelect(node, event)}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onItemSelect(node, event as unknown as MouseEvent<HTMLElement>)
          }}
        >
          <span aria-hidden className="i-ri-folder-5-line size-4 shrink-0 text-text-secondary" />
          {nameNode}
          {!readonly && detail && (
            <FileActions
              detail={detail}
              node={node}
              onCopy={onCopy}
              onCut={onCut}
              onSelect={onSelect}
              onUploadFiles={onUploadFiles}
              skillId={skillId}
              visible={actionsVisible}
            />
          )}
        </div>
        {node.children && node.children.length > 0 && (
          <ul className="ml-4 min-w-0 border-l border-divider-subtle pl-1">
            {node.children.map((child) => (
              <FileTreeItem
                detail={detail}
                draggingPath={draggingPath}
                dropTargetPath={dropTargetPath}
                key={child.id}
                node={child}
                onCopy={onCopy}
                onCut={onCut}
                onDropFiles={onDropFiles}
                onItemSelect={onItemSelect}
                onMove={onMove}
                onSelect={onSelect}
                onSetDraggingPath={onSetDraggingPath}
                onSetDropTarget={onSetDropTarget}
                onUploadFiles={onUploadFiles}
                readonly={readonly}
                selectedPaths={selectedPaths}
                selectedPath={selectedPath}
                skillId={skillId}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li
      className="min-w-0"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        data-skill-file-tree-item
        draggable={!readonly}
        className={cn(
          'group flex h-6 w-full min-w-0 items-center rounded-md text-text-secondary transition-colors hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-primary',
          isDropTarget && 'bg-state-accent-hover ring-1 ring-state-accent-solid',
          (selectedPath === node.path || isSelected) && 'bg-state-accent-hover text-text-accent',
          isDragging && 'opacity-50',
        )}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      >
        <button
          type="button"
          className="flex h-full w-0 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left system-xs-regular outline-hidden transition-colors group-hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          title={node.path}
          onClick={(event) => {
            onItemSelect(node, event)
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) onSelect(node.path)
          }}
        >
          <span
            aria-hidden
            className={cn('size-4 shrink-0', node.file && getSkillFileIconClass(node.file))}
          />
          {nameNode}
        </button>
        {!readonly && detail && (
          <div className="flex shrink-0 items-center">
            <FileActions
              detail={detail}
              node={node}
              onCopy={onCopy}
              onCut={onCut}
              onSelect={onSelect}
              onUploadFiles={onUploadFiles}
              skillId={skillId}
              visible={actionsVisible}
            />
          </div>
        )}
      </div>
    </li>
  )
}

function SkillTagsEditor({
  detail,
  readonly,
  skillId,
}: {
  detail: SkillDetailResponse | undefined
  readonly: boolean
  skillId: string
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [tagName, setTagName] = useState('')
  const tags = detail?.tags ?? []
  const metadataMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions(),
  )

  const saveTags = (
    nextTags: string[],
    options: {
      onSuccess?: () => void
      successMessage: string
    },
  ) => {
    if (!detail || metadataMutation.isPending) return

    metadataMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {
          expected_updated_at: detail.updated_at,
          tags: nextTags,
        },
      },
      {
        onSuccess: () => {
          toast.success(options.successMessage)
          invalidateSkillDetail(queryClient, skillId)
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
          })
          options.onSuccess?.()
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.updateTagsFailed']))
        },
      },
    )
  }

  const handleAddTag = () => {
    const trimmedTag = tagName.trim()
    if (!trimmedTag || tags.some((tag) => tag.toLowerCase() === trimmedTag.toLowerCase())) return

    saveTags([...tags, trimmedTag], {
      successMessage: t(($) => $['skillManagement.detail.addTagSuccess']),
      onSuccess: () => {
        setTagName('')
        setAddOpen(false)
      },
    })
  }

  const handleRemoveTag = (tagToRemove: string) => {
    saveTags(
      tags.filter((tag) => tag !== tagToRemove),
      {
        successMessage: t(($) => $['skillManagement.detail.removeTagSuccess']),
      },
    )
  }

  if (readonly && tags.length === 0) return null

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="group/tag flex max-w-full items-center gap-1 rounded-md border border-divider-regular bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary"
          >
            <span className="min-w-0 truncate">{tag}</span>
            {!readonly && (
              <button
                type="button"
                className="flex size-3.5 shrink-0 items-center justify-center rounded-sm text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => handleRemoveTag(tag)}
                aria-label={t(($) => $['skillManagement.detail.removeTag'], { tag })}
              >
                <span aria-hidden className="i-ri-close-line size-3" />
              </button>
            )}
          </span>
        ))}
        {!readonly && (
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md border border-divider-regular text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setAddOpen(true)}
            aria-label={t(($) => $['skillManagement.detail.addTag'])}
          >
            <span aria-hidden className="i-ri-add-line size-3.5" />
          </button>
        )}
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[420px] p-0!">
          <DialogCloseButton />
          <div className="px-6 pt-6 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['skillManagement.detail.addTag'])}
            </DialogTitle>
            <DialogDescription className="mt-2 system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.addTagDescription'])}
            </DialogDescription>
          </div>
          <div className="px-6 py-3">
            <Input
              value={tagName}
              onChange={(event) => setTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAddTag()
              }}
            />
          </div>
          <div className="flex justify-end gap-2 px-6 pt-3 pb-6">
            <Button disabled={metadataMutation.isPending} onClick={() => setAddOpen(false)}>
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button
              variant="primary"
              loading={metadataMutation.isPending}
              disabled={!tagName.trim()}
              onClick={handleAddTag}
            >
              {tCommon(($) => $['operation.add'])}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SkillReferencesPanel({ skillId }: { referenceCount: number; skillId: string }) {
  const { t } = useTranslation('agentV2')
  const referencesQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  )
  const references = referencesQuery.data?.data ?? []

  if (referencesQuery.isPending) {
    return (
      <div className="w-52 space-y-1 py-1">
        <SkeletonRectangle className="h-8 rounded-lg" />
        <SkeletonRectangle className="h-8 rounded-lg" />
      </div>
    )
  }

  if (references.length === 0) {
    return (
      <div className="w-max py-2 system-xs-regular text-text-quaternary">
        {t(($) => $['skillManagement.detail.referencedBy'], { count: 0 })}
      </div>
    )
  }

  return (
    <div className="w-max max-w-[480px] space-y-0.5 py-1">
      {references.map((reference) => (
        <SkillReferenceItem
          key={`${reference.type}:${reference.agent_id}:${reference.workflow_id ?? ''}:${reference.node_id ?? ''}`}
          reference={reference}
        />
      ))}
    </div>
  )
}

function SkillPublishConfirmPanel({
  loading,
  onCancel,
  onConfirm,
  open,
  referenceCount,
  skillId,
}: {
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  referenceCount: number
  skillId: string
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const referencesQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
      enabled: open,
    }),
  )
  const references = referencesQuery.data?.data ?? []

  if (!open) return null

  return (
    <div className="absolute right-0 bottom-[calc(100%+10px)] z-50 w-[420px] overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xl">
      <div className="px-6 pt-5 pb-4">
        <h2 className="title-xl-semi-bold text-text-primary">
          {t(($) => $['skillManagement.detail.publishReferencesTitle'])}
        </h2>
        <p className="mt-2 system-sm-regular text-util-colors-warning-warning-600">
          {t(($) => $['skillManagement.detail.publishReferencesDescription'], {
            count: referenceCount,
          })}
        </p>
      </div>
      <div className="px-5 pb-5">
        {referencesQuery.isPending ? (
          <div className="space-y-1">
            <SkeletonRectangle className="h-8 rounded-lg" />
            <SkeletonRectangle className="h-8 rounded-lg" />
            <SkeletonRectangle className="h-8 rounded-lg" />
          </div>
        ) : (
          <div className="max-h-36 overflow-y-auto rounded-xl border border-divider-subtle py-1">
            {references.map((reference) => (
              <SkillReferenceItem
                key={`${reference.type}:${reference.agent_id}:${reference.workflow_id ?? ''}:${reference.node_id ?? ''}`}
                reference={reference}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-divider-subtle px-6 py-5">
        <Button className="h-10 px-5" disabled={loading} onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button className="h-10 px-5" variant="primary" loading={loading} onClick={onConfirm}>
          {t(($) => $['skillManagement.detail.publishUpdate'])}
        </Button>
      </div>
    </div>
  )
}

function SkillReferenceItem({ reference }: { reference: SkillReferenceResponse }) {
  const isWorkflowAgent = reference.type === 'workflow_agent_node'
  const agentIconType = reference.agent_icon_type as AppIconType | null | undefined
  const agentImageUrl =
    reference.agent_icon_type === 'image' || reference.agent_icon_type === 'link'
      ? reference.agent_icon
      : undefined

  if (!isWorkflowAgent) {
    const title = reference.display_name || reference.name
    return (
      <Link
        href={`/agents/${reference.agent_id}/configure`}
        className="flex h-8 w-fit max-w-[480px] min-w-0 items-center gap-2 rounded-lg px-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="shrink-0">
          <AppIcon
            size="tiny"
            iconType={agentIconType}
            icon={reference.agent_icon ?? undefined}
            background={reference.agent_icon_background}
            imageUrl={agentImageUrl}
            innerIcon={
              agentIconType ? undefined : (
                <span className="i-ri-robot-2-line size-4 text-util-colors-blue-blue-600" />
              )
            }
          />
        </span>
        <span className="max-w-[252px] min-w-0 truncate system-sm-regular text-text-secondary">
          {title}
        </span>
        <span
          aria-hidden
          className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-quaternary"
        />
      </Link>
    )
  }

  const workflowName = reference.workflow_name || reference.display_name || reference.name
  const workflowIconType = reference.workflow_icon_type as AppIconType | null | undefined
  const workflowImageUrl =
    reference.workflow_icon_type === 'image' || reference.workflow_icon_type === 'link'
      ? reference.workflow_icon
      : undefined
  const workflowContent = (
    <>
      <span aria-hidden className="shrink-0">
        <AppIcon
          size="tiny"
          iconType={workflowIconType}
          icon={reference.workflow_icon ?? undefined}
          background={reference.workflow_icon_background}
          imageUrl={workflowImageUrl}
          innerIcon={
            workflowIconType ? undefined : (
              <span className="i-ri-flow-chart size-4 text-util-colors-blue-blue-600" />
            )
          }
        />
      </span>
      <span className="max-w-[252px] min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
        {workflowName}
      </span>
      <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-quaternary" />
    </>
  )

  if (reference.app_id) {
    return (
      <Link
        href={`/app/${reference.app_id}/workflow`}
        target="_blank"
        rel="noreferrer"
        className="flex h-8 w-fit max-w-[480px] min-w-0 items-center gap-2 rounded-lg px-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        {workflowContent}
      </Link>
    )
  }

  return (
    <div className="flex h-8 w-fit max-w-[480px] min-w-0 items-center gap-2 rounded-lg px-2 hover:bg-state-base-hover">
      {workflowContent}
    </div>
  )
}

function FileSearchDialog({
  files,
  onOpenChange,
  onSelect,
  open,
}: {
  files: SkillFileResponse[]
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  open: boolean
}) {
  const { t } = useTranslation('agentV2')
  const [query, setQuery] = useState('')
  const fileResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const fileItems = files.filter((file) => !isDirectory(file))
    if (!normalizedQuery) return fileItems

    return fileItems.filter((file) => {
      const path = file.path.toLowerCase()
      return path.includes(normalizedQuery) || getPathBaseName(path).includes(normalizedQuery)
    })
  }, [files, query])

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setQuery('')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-[24dvh] w-[480px] max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden! rounded-2xl border border-components-panel-border bg-components-panel-bg p-0! shadow-xl">
        <DialogTitle className="sr-only">
          {t(($) => $['skillManagement.detail.searchFiles'])}
        </DialogTitle>
        <div className="flex h-12 items-center gap-2 border-b border-divider-subtle px-4">
          <span aria-hidden className="i-ri-search-2-line size-4 shrink-0 text-text-quaternary" />
          <Input
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- The file search dialog opens from an explicit search action and should focus the query field.
            autoFocus
            value={query}
            placeholder={t(($) => $['skillManagement.detail.searchFiles'])}
            aria-label={t(($) => $['skillManagement.detail.searchFiles'])}
            className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const firstFile = fileResults[0]
              if (!firstFile) return

              event.preventDefault()
              onSelect(firstFile.path)
              handleOpenChange(false)
            }}
          />
        </div>
        <div className="max-h-[320px] min-h-48 overflow-y-auto p-2">
          {fileResults.length > 0 ? (
            <div className="space-y-1">
              {fileResults.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => {
                    onSelect(file.path)
                    handleOpenChange(false)
                  }}
                >
                  <span
                    aria-hidden
                    className={cn('size-4 shrink-0', getSkillFileIconClass(file))}
                  />
                  <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
                    {file.path}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-center system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.noSearchResults'])}
            </div>
          )}
        </div>
        <div className="flex h-9 items-center justify-between border-t border-divider-subtle px-4 system-xs-regular text-text-quaternary">
          <span>{t(($) => $['skillManagement.detail.searchFiles'])}</span>
          <span>ESC</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SkillUploadStatusPanel({
  items,
  onDismiss,
}: {
  items: SkillUploadQueueItem[]
  onDismiss: () => void
}) {
  const { t } = useTranslation('agentV2')
  if (items.length === 0) return null

  const uploadedCount = items.filter((item) => item.status === 'uploaded').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const completedCount = uploadedCount + failedCount
  const activeItem = items.find((item) => item.status === 'uploading' || item.status === 'saving')
  const averageProgress =
    items.reduce((sum, item) => {
      if (item.status === 'uploaded' || item.status === 'failed') return sum + 100
      return sum + item.progress
    }, 0) / items.length
  const hasActiveUpload = Boolean(activeItem)
  const hasFailures = failedCount > 0

  return (
    <div className="mb-3 space-y-2">
      <div className="overflow-hidden rounded-lg border border-divider-regular bg-background-default shadow-xs">
        <div className="flex h-9 items-center gap-2 px-3">
          <span
            aria-hidden
            className={cn(
              'size-4 shrink-0',
              hasFailures
                ? 'i-ri-error-warning-line text-text-warning-secondary'
                : 'i-ri-upload-cloud-2-line text-text-accent',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate system-xs-semibold text-text-secondary">
              {hasActiveUpload
                ? t(($) => $['skillManagement.detail.uploadFilesProgress'], {
                    completed: completedCount,
                    total: items.length,
                  })
                : t(($) => $['skillManagement.detail.uploadFilesStatus'])}
            </div>
            {activeItem && (
              <div className="truncate system-2xs-regular text-text-tertiary">
                {activeItem.name}
              </div>
            )}
          </div>
          {!hasActiveUpload && (
            <button
              type="button"
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              aria-label={t(($) => $['skillManagement.detail.uploadStatusDismiss'])}
              onClick={onDismiss}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          )}
        </div>
        {hasActiveUpload && (
          <div className="h-1 bg-components-progress-bar-bg">
            <div
              className="h-full bg-components-progress-bar-progress-solid transition-[width]"
              style={{ width: `${averageProgress}%` }}
            />
          </div>
        )}
      </div>
      {!hasActiveUpload && (
        <div
          className={cn(
            'flex min-h-8 items-center gap-2 rounded-lg border px-3 py-2 system-xs-regular shadow-xs',
            hasFailures
              ? 'border-components-badge-status-light-warning-halo bg-state-warning-hover text-text-secondary'
              : 'border-state-success-active bg-state-success-hover text-text-secondary',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-4 shrink-0',
              hasFailures
                ? 'i-ri-alert-line text-text-warning-secondary'
                : 'i-ri-checkbox-circle-fill text-text-success',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              {t(($) => $['skillManagement.detail.uploadFilesResult'], {
                failed: failedCount,
                uploaded: uploadedCount,
              })}
            </div>
            {hasFailures && (
              <div className="mt-1 space-y-1">
                {items
                  .filter((item) => item.status === 'failed')
                  .map((item) => (
                    <div key={item.id} className="truncate text-text-tertiary">
                      {item.name}: {item.error}
                    </div>
                  ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={t(($) => $['skillManagement.detail.uploadStatusDismiss'])}
            onClick={onDismiss}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function FileTree({
  collapsed,
  detail,
  files,
  onCollapsedChange,
  onSelect,
  readonly,
  selectedPath,
  skillId,
}: {
  collapsed: boolean
  detail: SkillDetailResponse | undefined
  files: SkillFileResponse[]
  onCollapsedChange: (collapsed: boolean) => void
  onSelect: (path: string) => void
  readonly: boolean
  selectedPath: string | undefined
  skillId: string
}) {
  const { t } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const referencesRegionRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [createFileOpen, setCreateFileOpen] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [draggingPath, setDraggingPath] = useState<string>()
  const [dropTargetPath, setDropTargetPath] = useState<string>()
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>()
  const [clipboard, setClipboard] = useState<SkillFileClipboard>()
  const [uploadItems, setUploadItems] = useState<SkillUploadQueueItem[]>([])

  const handleReferencesRegionBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setReferencesOpen(false)
  }, [])

  useEffect(() => {
    if (!referencesOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (referencesRegionRef.current?.contains(target)) return
      setReferencesOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [referencesOpen])

  const fileMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const tree = toFileTree(files)
  const flatTree = flattenFileTree(tree)
  const isUploading = uploadItems.some(
    (item) => item.status === 'uploading' || item.status === 'saving',
  )
  const isMutating = fileMutation.isPending || isUploading
  const fileCount = files.filter((file) => !isDirectory(file)).length

  const mutateFile = (
    body: Parameters<typeof fileMutation.mutate>[0]['body'],
    options: {
      onSuccess?: () => void
      successMessage: string
    },
  ) => {
    if (!detail || fileMutation.isPending) return

    fileMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {
          ...body,
          expected_updated_at: detail.updated_at,
        },
      },
      {
        onSuccess: (nextDetail) => {
          toast.success(options.successMessage)
          setSkillDetailCache(queryClient, skillId, nextDetail)
          invalidateSkillDetail(queryClient, skillId)
          options.onSuccess?.()
        },
        onError: (error) => {
          showSkillErrorToast(
            error,
            t(($) => $['skillManagement.detail.fileOperationFailed']),
          )
        },
      },
    )
  }

  const handleCreateFile = (path: string) => {
    mutateFile(
      {
        content: '',
        mime_type: 'text/markdown',
        operation: 'upsert_text',
        path,
        size: 0,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.createFileSuccess']),
        onSuccess: () => {
          setCreateFileOpen(false)
          onSelect(path)
        },
      },
    )
  }

  const handleCreateFolder = (path: string) => {
    mutateFile(
      {
        operation: 'mkdir',
        path,
      },
      {
        successMessage: t(($) => $['skillManagement.detail.createFolderSuccess']),
        onSuccess: () => {
          setCreateFolderOpen(false)
        },
      },
    )
  }

  const patchUploadItem = (id: string, patch: Partial<SkillUploadQueueItem>) => {
    setUploadItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  const handleUploadFiles = async (filesToUpload: File[], targetDirectory: string | undefined) => {
    if (!detail || filesToUpload.length === 0 || isMutating) return

    const nextUploadItems = filesToUpload.map((file, index) => ({
      id: createUploadItemId(file, index),
      name: getUploadFileName(file),
      progress: 0,
      status: 'uploading' as const,
    }))
    setUploadItems(nextUploadItems)

    let latestDetail = detail
    let expectedUpdatedAt = detail.updated_at
    let lastUploadedPath = ''
    let successCount = 0
    let failedCount = 0

    for (const [index, file] of filesToUpload.entries()) {
      const item = nextUploadItems[index]
      if (!item) continue

      try {
        patchUploadItem(item.id, { progress: 0, status: 'uploading' })
        const uploadedFile = await uploadSkillFile(file, {
          onProgress: (progress) => {
            patchUploadItem(item.id, { progress: Math.min(progress, 99) })
          },
        })
        patchUploadItem(item.id, { progress: 100, status: 'saving' })

        const path = getUploadPath(file, targetDirectory)
        const nextDetail = await fileMutation.mutateAsync({
          params: {
            skill_id: skillId,
          },
          body: {
            expected_updated_at: expectedUpdatedAt,
            mime_type: uploadedFile.mime_type ?? file.type,
            operation: 'upsert_tool_file',
            path,
            size: uploadedFile.size,
            tool_file_id: uploadedFile.id,
          },
        })

        latestDetail = nextDetail
        expectedUpdatedAt = nextDetail.updated_at
        lastUploadedPath = path
        successCount += 1
        patchUploadItem(item.id, { progress: 100, status: 'uploaded' })
      } catch (error) {
        failedCount += 1
        patchUploadItem(item.id, {
          error:
            (await getAsyncSkillErrorMessage(error)) ??
            t(($) => $['skillManagement.detail.uploadFileFailed']),
          progress: 100,
          status: 'failed',
        })
      }
    }

    if (successCount > 0) {
      setSkillDetailCache(queryClient, skillId, latestDetail)
      invalidateSkillDetail(queryClient, skillId)
      if (lastUploadedPath) onSelect(lastUploadedPath)
    }

    if (failedCount > 0) {
      toast.error(
        t(($) => $['skillManagement.detail.uploadFilesFailedStatus'], { count: failedCount }),
      )
      return
    }

    toast.success(t(($) => $['skillManagement.detail.uploadFileSuccess']))
  }

  const handleItemSelect = (node: FileTreeNode, event: MouseEvent<HTMLElement>) => {
    const currentPath = node.path
    const isAdditive = event.metaKey || event.ctrlKey

    if (event.shiftKey && selectionAnchorPath) {
      const anchorIndex = flatTree.findIndex((item) => item.path === selectionAnchorPath)
      const currentIndex = flatTree.findIndex((item) => item.path === currentPath)

      if (anchorIndex >= 0 && currentIndex >= 0) {
        const [startIndex, endIndex] =
          anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex]
        const rangePaths = flatTree.slice(startIndex, endIndex + 1).map((item) => item.path)

        setSelectedPaths(
          isAdditive ? Array.from(new Set([...selectedPaths, ...rangePaths])) : rangePaths,
        )
        return
      }
    }

    if (isAdditive) {
      setSelectedPaths((currentPaths) =>
        currentPaths.includes(currentPath)
          ? currentPaths.filter((path) => path !== currentPath)
          : [...currentPaths, currentPath],
      )
      setSelectionAnchorPath(currentPath)
      return
    }

    setSelectedPaths([currentPath])
    setSelectionAnchorPath(currentPath)
  }

  const getMovablePaths = (sourcePaths: string[], targetDirectory: string | undefined) => {
    const uniquePaths = Array.from(new Set(sourcePaths))
    return uniquePaths.filter((sourcePath) => {
      if (
        targetDirectory &&
        (sourcePath === targetDirectory || isNestedPath(sourcePath, targetDirectory))
      )
        return false

      return !uniquePaths.some(
        (candidatePath) => candidatePath !== sourcePath && isNestedPath(candidatePath, sourcePath),
      )
    })
  }

  const getActionPaths = (path: string) => (selectedPaths.includes(path) ? selectedPaths : [path])
  const getFileActionPaths = (path: string) =>
    getActionPaths(path).filter((actionPath) => {
      const file = findFileByPath(files, actionPath)
      return file && !isDirectory(file)
    })

  const handleCut = (path: string) => {
    const filePaths = getFileActionPaths(path)
    if (filePaths.length === 0) return

    setClipboard({ mode: 'cut', paths: filePaths })
    toast.success(t(($) => $['skillManagement.detail.cutFileSuccess']))
  }

  const handleCopy = (path: string) => {
    const filePaths = getFileActionPaths(path)
    if (filePaths.length === 0) return

    setClipboard({ mode: 'copy', paths: filePaths })
    toast.success(t(($) => $['skillManagement.detail.copyFileSuccess']))
  }

  const handleMove = async (sourcePaths: string[], targetDirectory: string | undefined) => {
    if (!detail || fileMutation.isPending) return
    const movablePaths = getMovablePaths(sourcePaths, targetDirectory)
    if (movablePaths.length === 0) return

    try {
      let lastTargetPath = ''
      let latestDetail = detail
      let expectedUpdatedAt = detail.updated_at
      for (const sourcePath of movablePaths) {
        const targetPath = joinSkillPath(targetDirectory, getPathBaseName(sourcePath))
        if (sourcePath === targetPath) continue

        const nextDetail = await fileMutation.mutateAsync({
          params: {
            skill_id: skillId,
          },
          body: {
            expected_updated_at: expectedUpdatedAt,
            operation: 'rename',
            path: sourcePath,
            target_path: targetPath,
          },
        })
        expectedUpdatedAt = nextDetail.updated_at
        latestDetail = nextDetail
        lastTargetPath = targetPath
      }

      toast.success(
        movablePaths.length > 1
          ? t(($) => $['skillManagement.detail.moveFilesSuccess'])
          : t(($) => $['skillManagement.detail.moveFileSuccess']),
      )
      setSkillDetailCache(queryClient, skillId, latestDetail)
      invalidateSkillDetail(queryClient, skillId)
      setSelectedPaths(
        movablePaths.map((path) => joinSkillPath(targetDirectory, getPathBaseName(path))),
      )
      if (lastTargetPath) onSelect(lastTargetPath)
    } catch (error) {
      showSkillErrorToast(
        error,
        t(($) => $['skillManagement.detail.fileOperationFailed']),
      )
    }
  }

  const handleCopyFiles = async (sourcePaths: string[], targetDirectory: string | undefined) => {
    if (!detail || fileMutation.isPending) return
    const copyablePaths = getMovablePaths(sourcePaths, targetDirectory).filter((sourcePath) => {
      const file = findFileByPath(files, sourcePath)
      return file && !isDirectory(file)
    })
    if (copyablePaths.length === 0) return

    try {
      let lastTargetPath = ''
      let latestDetail = detail
      let expectedUpdatedAt = detail.updated_at
      const copiedTargetPaths: string[] = []
      for (const sourcePath of copyablePaths) {
        const sourceFile = findFileByPath(files, sourcePath)
        if (!sourceFile || isDirectory(sourceFile)) continue
        const targetPath = getCopyTargetPath(files, targetDirectory, sourcePath, copiedTargetPaths)
        if (!targetPath) throw new Error('target path already exists')

        let nextDetail: SkillDetailResponse
        if (sourceFile.tool_file_id) {
          nextDetail = await fileMutation.mutateAsync({
            params: {
              skill_id: skillId,
            },
            body: {
              expected_updated_at: expectedUpdatedAt,
              hash: sourceFile.hash,
              mime_type: sourceFile.mime_type,
              operation: 'upsert_tool_file',
              path: targetPath,
              size: sourceFile.size,
              tool_file_id: sourceFile.tool_file_id,
            },
          })
        } else {
          const content =
            sourceFile.content ??
            (await (
              await fetchSkillFileBlob({
                path: sourcePath,
                skillId,
                versionId: null,
              })
            ).text())
          nextDetail = await fileMutation.mutateAsync({
            params: {
              skill_id: skillId,
            },
            body: {
              content,
              expected_updated_at: expectedUpdatedAt,
              hash: sourceFile.hash,
              mime_type: sourceFile.mime_type,
              operation: 'upsert_text',
              path: targetPath,
              size: new Blob([content]).size,
            },
          })
        }
        expectedUpdatedAt = nextDetail.updated_at
        latestDetail = nextDetail
        lastTargetPath = targetPath
        copiedTargetPaths.push(targetPath)
      }
      if (copiedTargetPaths.length === 0) return

      toast.success(t(($) => $['skillManagement.detail.pasteFileSuccess']))
      setSkillDetailCache(queryClient, skillId, latestDetail)
      invalidateSkillDetail(queryClient, skillId)
      setSelectedPaths(copiedTargetPaths)
      if (lastTargetPath) onSelect(lastTargetPath)
    } catch (error) {
      showSkillErrorToast(
        error,
        t(($) => $['skillManagement.detail.fileOperationFailed']),
      )
    }
  }

  const handlePaste = (targetDirectory: string | undefined) => {
    if (!clipboard) return

    if (clipboard.mode === 'cut') {
      void handleMove(clipboard.paths, targetDirectory)
      setClipboard(undefined)
      return
    }

    void handleCopyFiles(clipboard.paths, targetDirectory)
  }

  const getPasteTargetDirectory = () => {
    if (selectedPaths.length !== 1) return undefined

    const selectedFile = findFileByPath(files, selectedPaths[0])
    if (!selectedFile) return undefined
    if (isDirectory(selectedFile)) return selectedFile.path

    return getPathDirName(selectedFile.path) || undefined
  }

  useEffect(() => {
    const handlePasteEvent = (event: ClipboardEvent) => {
      if (readonly || !clipboard || fileMutation.isPending) return
      if (isEditableKeyboardTarget(event.target)) return

      event.preventDefault()
      requestAnimationFrame(() => {
        handlePaste(getPasteTargetDirectory())
      })
    }

    document.addEventListener('paste', handlePasteEvent)
    return () => document.removeEventListener('paste', handlePasteEvent)
  })

  const handleRootDragOver = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes('Files')
      ? 'copy'
      : 'move'
    setDropTargetPath('')
  }

  const handleRootDrop = (event: DragEvent<HTMLElement>) => {
    if (readonly) return

    event.preventDefault()
    setDropTargetPath(undefined)

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) {
      void handleUploadFiles(droppedFiles, undefined)
      return
    }

    const sourcePaths = getDraggedSkillPaths(event.dataTransfer)
    if (sourcePaths.length > 0) void handleMove(sourcePaths, undefined)
  }

  const handleRootDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return

    setDropTargetPath(undefined)
  }

  const handleRootClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-skill-file-tree-item]')) return

    setSelectedPaths([])
    setSelectionAnchorPath(undefined)
  }

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center overflow-hidden border-r border-divider-subtle bg-background-default py-3">
        <button
          type="button"
          aria-label={t(($) => $['skillManagement.detail.expandSidebar'])}
          title={t(($) => $['skillManagement.detail.expandSidebar'])}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => onCollapsedChange(false)}
        >
          <span aria-hidden className="i-ri-sidebar-unfold-line size-4" />
        </button>
      </aside>
    )
  }

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col overflow-visible border-r border-divider-subtle bg-background-default">
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <Link
            href="/skills"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={t(($) => $['skillManagement.detail.back'])}
          >
            <span aria-hidden className="i-ri-arrow-left-line size-4" />
          </Link>
          <span aria-hidden className="i-ri-box-3-line size-5 shrink-0 text-text-secondary" />
          <h1 className="min-w-0 flex-1 truncate system-sm-semibold text-text-primary">SKILLS</h1>
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.searchFiles'])}
            title={t(($) => $['skillManagement.detail.searchFiles'])}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setSearchDialogOpen(true)}
          >
            <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
          </button>
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.collapseSidebar'])}
            title={t(($) => $['skillManagement.detail.collapseSidebar'])}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => onCollapsedChange(true)}
          >
            <span aria-hidden className="i-ri-sidebar-fold-line size-4" />
          </button>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-divider-subtle bg-background-default">
              {detail?.icon ? (
                <span className="system-md-medium text-text-secondary">{detail.icon}</span>
              ) : (
                <span aria-hidden className="i-ri-box-3-line size-5 text-text-secondary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate system-sm-semibold text-text-primary">
                {detail?.display_name ?? skillId}
              </h2>
              <p className="truncate system-xs-regular text-text-tertiary">
                {detail?.name ?? skillId}
              </p>
            </div>
          </div>
          <SkillTagsEditor detail={detail} readonly={readonly} skillId={skillId} />
        </div>
        <div className="mx-4 border-t border-divider-subtle" />
        <div className="flex h-10 shrink-0 items-center gap-2 px-4">
          <h2 className="min-w-0 flex-1 system-xs-medium-uppercase text-text-tertiary">
            {t(($) => $['skillManagement.detail.fileCount'], { count: fileCount })}
          </h2>
          {!readonly && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
                disabled={!detail || isMutating}
              >
                <span aria-hidden className="i-ri-add-line size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent placement="bottom-end" popupClassName="w-52 p-1">
                <DropdownMenuItem className="gap-2 py-2" onClick={() => setCreateFileOpen(true)}>
                  <span aria-hidden className="i-ri-file-add-line size-4 text-text-secondary" />
                  <span className="system-sm-regular">
                    {t(($) => $['skillManagement.detail.createFileMenu'])}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 py-2" onClick={() => setCreateFolderOpen(true)}>
                  <span aria-hidden className="i-ri-folder-add-line size-4 text-text-secondary" />
                  <span className="system-sm-regular">
                    {t(($) => $['skillManagement.detail.createFolderMenu'])}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 py-2"
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <span
                    aria-hidden
                    className="i-ri-upload-cloud-2-line size-4 text-text-secondary"
                  />
                  <span className="system-sm-regular">
                    {t(($) => $['skillManagement.detail.uploadFilesMenu'])}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleUploadFiles(Array.from(event.target.files ?? []), undefined)
              event.target.value = ''
            }}
          />
        </div>
        <ScrollAreaRoot className="min-h-0 flex-1 overflow-hidden">
          <ScrollAreaViewport tabIndex={-1}>
            <ScrollAreaContent
              className={cn(
                'min-h-full min-w-0 px-3 pb-3',
                dropTargetPath === '' && 'bg-state-base-hover',
              )}
              onDragLeave={handleRootDragLeave}
              onDragOver={handleRootDragOver}
              onDrop={handleRootDrop}
              onClick={handleRootClick}
            >
              {tree.length === 0 ? (
                <p className="px-2 py-3 system-xs-regular text-text-tertiary">
                  {t(($) => $['skillManagement.detail.noFiles'])}
                </p>
              ) : (
                <ul className="min-w-0 space-y-0.5">
                  {tree.map((node) => (
                    <FileTreeItem
                      detail={detail}
                      draggingPath={draggingPath}
                      dropTargetPath={dropTargetPath}
                      key={node.id}
                      node={node}
                      onCopy={handleCopy}
                      onCut={handleCut}
                      onDropFiles={(filesToUpload, targetDirectory) => {
                        void handleUploadFiles(filesToUpload, targetDirectory)
                      }}
                      onItemSelect={handleItemSelect}
                      onMove={handleMove}
                      onSelect={onSelect}
                      onSetDraggingPath={setDraggingPath}
                      onSetDropTarget={(targetPath) => {
                        setDropTargetPath(targetPath)
                      }}
                      onUploadFiles={(filesToUpload, targetDirectory) => {
                        void handleUploadFiles(filesToUpload, targetDirectory)
                      }}
                      readonly={readonly}
                      selectedPaths={selectedPaths}
                      selectedPath={selectedPath}
                      skillId={skillId}
                    />
                  ))}
                </ul>
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
        <div className="mx-4 border-t border-divider-subtle py-3">
          <SkillUploadStatusPanel items={uploadItems} onDismiss={() => setUploadItems([])} />
          <div ref={referencesRegionRef} onBlur={handleReferencesRegionBlur}>
            <button
              type="button"
              className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md text-left system-xs-regular text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              aria-expanded={referencesOpen}
              onClick={() => setReferencesOpen((open) => !open)}
            >
              <span aria-hidden className="i-ri-apps-2-line size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t(($) => $['skillManagement.detail.referencedBy'], {
                  count: detail?.reference_count ?? 0,
                })}
              </span>
              <span
                aria-hidden
                className={cn(
                  'i-ri-arrow-right-s-line size-4 text-text-quaternary transition-transform',
                  referencesOpen && 'rotate-90',
                )}
              />
            </button>
            {referencesOpen && (
              <div className="relative z-20 mt-1">
                <SkillReferencesPanel
                  referenceCount={detail?.reference_count ?? 0}
                  skillId={skillId}
                />
              </div>
            )}
          </div>
          <div className="flex h-7 items-center gap-2 system-xs-regular text-text-tertiary">
            <span aria-hidden className="i-ri-account-circle-line size-4 shrink-0" />
            <span className="min-w-0 truncate">
              {t(($) => $['skillManagement.detail.createdBy'], {
                name: detail?.created_by_name ?? detail?.created_by ?? '-',
              })}
            </span>
          </div>
        </div>
        <SkillFilePathDialog
          open={createFileOpen}
          onOpenChange={setCreateFileOpen}
          defaultPath="new-file.md"
          title={t(($) => $['skillManagement.detail.createFile'])}
          description={t(($) => $['skillManagement.detail.createFileDescription'])}
          loading={fileMutation.isPending}
          onSubmit={handleCreateFile}
        />
        <SkillFilePathDialog
          open={createFolderOpen}
          onOpenChange={setCreateFolderOpen}
          defaultPath="new-folder"
          title={t(($) => $['skillManagement.detail.createFolder'])}
          description={t(($) => $['skillManagement.detail.createFolderDescription'])}
          loading={fileMutation.isPending}
          onSubmit={handleCreateFolder}
        />
      </aside>
      <FileSearchDialog
        files={files}
        open={searchDialogOpen}
        onOpenChange={setSearchDialogOpen}
        onSelect={onSelect}
      />
    </>
  )
}

function MarkdownModeSwitch({
  mode,
  onChange,
}: {
  mode: 'live' | 'source'
  onChange: (mode: 'live' | 'source') => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="absolute top-3 right-3 z-10 flex h-8 items-center rounded-lg border border-divider-subtle bg-background-default p-0.5 shadow-xs">
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.markdownLiveMode'])}
        title={t(($) => $['skillManagement.detail.markdownLiveMode'])}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          mode === 'live' && 'bg-state-base-hover text-text-primary shadow-xs',
        )}
        onClick={() => onChange('live')}
      >
        <span aria-hidden className="i-ri-eye-line size-4" />
      </button>
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.markdownSourceMode'])}
        title={t(($) => $['skillManagement.detail.markdownSourceMode'])}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          mode === 'source' && 'bg-state-base-hover text-text-primary shadow-xs',
        )}
        onClick={() => onChange('source')}
      >
        <span aria-hidden className="i-ri-code-s-slash-line size-4" />
      </button>
    </div>
  )
}

function ReferenceFilesPicker({
  anchor,
  confirmText,
  currentDirectory,
  emptyText,
  files,
  navigateText,
  onBack,
  onSelect,
  onSelectIndex,
  query,
  selectedIndex,
  title,
}: {
  anchor?: { x: number; y: number }
  confirmText: string
  currentDirectory: string
  emptyText: string
  files: SkillFileResponse[]
  navigateText: string
  onBack: () => void
  onSelect: (file: SkillFileResponse) => void
  onSelectIndex: (index: number) => void
  query: string
  selectedIndex: number
  title: string
}) {
  const safeAnchor = anchor ?? { x: 32, y: 64 }
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const left = Math.min(safeAnchor.x, viewportWidth - 376)
  const top = Math.min(safeAnchor.y, viewportHeight - 340)

  return (
    <div
      className="fixed z-50 w-[360px] overflow-hidden rounded-xl border border-divider-regular bg-components-panel-bg shadow-lg"
      style={{
        left: Math.max(left, 16),
        top: Math.max(top, 16),
      }}
    >
      <div className="flex h-10 items-center gap-2 border-b border-divider-subtle px-3">
        <span aria-hidden className="i-ri-folder-3-line size-4 text-text-tertiary" />
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
          {currentDirectory || title}
        </span>
        {query && (
          <span className="max-w-28 truncate system-xs-regular text-text-quaternary">{query}</span>
        )}
      </div>
      <div className="max-h-[280px] overflow-y-auto p-1">
        {currentDirectory && (
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onBack}
          >
            <span
              aria-hidden
              className="i-ri-arrow-left-s-line size-4 shrink-0 text-text-tertiary"
            />
            <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
              ..
            </span>
          </button>
        )}
        {files.length > 0 ? (
          files.map((referenceFile, index) => {
            const selected = index === selectedIndex

            return (
              <button
                key={referenceFile.path}
                type="button"
                className={cn(
                  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  selected && 'bg-state-base-hover',
                )}
                onMouseEnter={() => onSelectIndex(index)}
                onClick={() => onSelect(referenceFile)}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0',
                    isDirectory(referenceFile) && selected
                      ? 'i-ri-folder-open-line text-text-secondary'
                      : getSkillFileIconClass(referenceFile),
                  )}
                />
                <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
                  {getPathBaseName(referenceFile.path)}
                </span>
                {isDirectory(referenceFile) && (
                  <span
                    aria-hidden
                    className="i-ri-arrow-right-s-line size-4 text-text-quaternary"
                  />
                )}
              </button>
            )
          })
        ) : (
          <div className="px-3 py-8 text-center system-sm-regular text-text-tertiary">
            {emptyText}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-divider-subtle px-3 py-2 system-xs-regular text-text-tertiary">
        <span>{navigateText}</span>
        <span>{confirmText}</span>
      </div>
    </div>
  )
}

function MarkdownBodyReferencePreview({
  body,
  className,
  placeholder,
}: {
  body: string
  className?: string
  placeholder: string
}) {
  const segments = parseMarkdownBodyReferences(body)

  if (!body) {
    return (
      <div className={cn('text-[15px]/7 whitespace-pre-wrap text-text-quaternary', className)}>
        {placeholder}
      </div>
    )
  }

  return (
    <div className={cn('text-[15px]/7 whitespace-pre-wrap text-text-secondary', className)}>
      {segments.map((segment) => {
        if (segment.type === 'text') return <span key={segment.key}>{segment.text}</span>

        const pathSegments = getReferencePathSegments(segment.path, segment.label)

        return (
          <span
            key={segment.key}
            className="mx-0.5 inline-flex translate-y-1 items-center gap-0.5"
            title={segment.path}
          >
            {pathSegments.map((pathSegment, segmentIndex) => {
              const partialPath = pathSegments.slice(0, segmentIndex + 1).join('/')
              const isLastSegment = segmentIndex === pathSegments.length - 1

              return (
                <span
                  key={partialPath}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-util-colors-blue-blue-300 bg-util-colors-blue-blue-100 px-1.5 text-util-colors-blue-blue-700"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0',
                      isLastSegment
                        ? getReferenceIconClass(segment.path)
                        : 'i-ri-folder-5-line text-util-colors-blue-blue-600',
                    )}
                  />
                  <span className="max-w-48 truncate">{pathSegment}</span>
                </span>
              )
            })}
          </span>
        )
      })}
    </div>
  )
}

function MarkdownLiveBodyEditor({
  body,
  editorRef,
  onInput,
  onKeyDown,
  placeholder,
}: {
  body: string
  editorRef: RefObject<HTMLDivElement | null>
  onInput: (event: FormEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  placeholder: string
}) {
  const renderedBodyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const root = editorRef.current
    if (!root) return
    if (renderedBodyRef.current === body) return
    if (root.ownerDocument.activeElement === root) return

    renderMarkdownLiveEditorContent(root, body)
    renderedBodyRef.current = body
  }, [body, editorRef])

  return (
    <div
      ref={editorRef}
      contentEditable
      role="textbox"
      aria-multiline="true"
      tabIndex={0}
      suppressContentEditableWarning
      className="relative min-h-[360px] w-full bg-transparent text-[15px]/7 break-words whitespace-pre-wrap text-text-secondary caret-text-secondary outline-none empty:before:pointer-events-none empty:before:text-text-quaternary empty:before:content-[attr(data-placeholder)]"
      data-placeholder={placeholder}
      onInput={onInput}
      onKeyDown={onKeyDown}
    />
  )
}

function CsvTablePreview({ rows }: { rows: string[][] }) {
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0)

  if (rows.length === 0 || columnCount === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-divider-regular bg-background-default">
        <span className="system-sm-regular text-text-tertiary">-</span>
      </div>
    )
  }

  const [headerRow, ...bodyRows] = rows
  const headers = Array.from({ length: columnCount }, (_, index) => headerRow?.[index] ?? '')
  const columnKeys = Array.from({ length: columnCount }, (_, index) => `column-${index + 1}`)

  return (
    <div className="h-full overflow-auto rounded-xl border border-divider-regular bg-background-default">
      <table className="min-w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-background-section">
          <tr>
            {headers.map((header, index) => (
              <th
                key={columnKeys[index]}
                scope="col"
                className="max-w-72 min-w-32 border-r border-b border-divider-subtle px-3 py-2 system-xs-semibold-uppercase text-text-tertiary last:border-r-0"
              >
                <span className="block truncate" title={header || undefined}>
                  {header || `#${index + 1}`}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row) => (
            <tr key={row.join('\u0000')} className="hover:bg-state-base-hover">
              {columnKeys.map((columnKey, columnIndex) => {
                const value = row[columnIndex] ?? ''

                return (
                  <td
                    key={columnKey}
                    className="max-w-72 min-w-32 border-r border-b border-divider-subtle px-3 py-2 align-top system-sm-regular text-text-secondary last:border-r-0"
                  >
                    <span
                      className="block break-words whitespace-pre-wrap"
                      title={value || undefined}
                    >
                      {value || '-'}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VersionActionBar({
  onExit,
  onRestore,
  restoring,
  version,
}: {
  onExit: () => void
  onRestore: () => void
  restoring: boolean
  version: SkillVersionResponse
}) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const publishedBy = version.published_by_name ?? version.published_by ?? '-'
  const publishedAt = formatTime(
    version.created_at,
    t(($) => $['skillManagement.dateTimeFormat']),
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
      <div className="pointer-events-auto flex h-14 w-[428px] max-w-[calc(100%-2rem)] items-center gap-4 rounded-xl border border-divider-subtle bg-background-default px-4 shadow-xl">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate system-sm-semibold text-text-primary">
              {version.version_name}
            </span>
            <span className="border-state-accent-border shrink-0 rounded-[5px] border bg-state-accent-hover px-1.5 py-0.5 system-2xs-semibold-uppercase text-text-accent">
              {t(($) => $['skillManagement.detail.viewOnly'])}
            </span>
          </div>
          <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
            {t(($) => $['skillManagement.detail.versionPublishedMeta'], {
              name: publishedBy,
              time: publishedAt,
            })}
          </div>
        </div>
        <Button variant="primary" className="h-9 px-5" loading={restoring} onClick={onRestore}>
          {t(($) => $['skillManagement.detail.restoreVersion'])}
        </Button>
        <Button variant="secondary" className="h-9 px-4" onClick={onExit}>
          <span aria-hidden className="i-ri-history-line size-4" />
          {t(($) => $['skillManagement.detail.exitVersions'])}
        </Button>
      </div>
    </div>
  )
}

function FileEditor({
  detail,
  file,
  onOpenVersions,
  onPublish,
  onRestoreVersion,
  onExitVersion,
  onCloseFile,
  onSelectFile,
  openFiles,
  publishing,
  readonly,
  selectedPath,
  selectedVersion,
  selectedVersionId,
  skillId,
}: {
  detail: SkillDetailResponse | undefined
  file: SkillFileResponse | undefined
  onOpenVersions: () => void
  onPublish: () => void
  onRestoreVersion: () => void
  onExitVersion: () => void
  onCloseFile: (path: string) => void
  onSelectFile: (path: string) => void
  openFiles: SkillFileResponse[]
  publishing: boolean
  readonly: boolean
  selectedPath: string | undefined
  selectedVersion: SkillVersionResponse | undefined
  selectedVersionId: string | null
  skillId: string
}) {
  const { t } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const initialContent = file && isTextFile(file) ? (file.content ?? '') : ''
  const initialSavedAt = detail?.updated_at ? detail.updated_at * 1000 : undefined
  const [draftContent, setDraftContent] = useState(initialContent)
  const [markdownMode, setMarkdownMode] = useState<'live' | 'source'>('live')
  const [metadataAdding, setMetadataAdding] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [metadataKey, setMetadataKey] = useState('')
  const [metadataValue, setMetadataValue] = useState('')
  const [referencePicker, setReferencePicker] = useState<{
    anchor: { x: number; y: number }
    currentDirectory: string
    query: string
    slashIndex: number
  } | null>(null)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [referenceSelectedIndex, setReferenceSelectedIndex] = useState(0)
  const [saveStatus, setSaveStatus] = useState<'dirty' | 'error' | 'saved' | 'saving'>('saved')
  const [savedAt, setSavedAt] = useState<number | undefined>(initialSavedAt)
  const draftContentRef = useRef(initialContent)
  const lastSavedContentRef = useRef(initialContent)
  const fileRef = useRef(file)
  const liveBodyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const liveBodyEditorRef = useRef<HTMLDivElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const { isPending: isSavingDraft, mutateAsync: saveDraftFile } = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const { mutateAsync: updateSkillMetadata } = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions({
      context: { silent: true },
    }),
  )

  const canEdit = !!file && isTextFile(file) && !readonly
  const codeLanguage = getSkillCodeLanguage(file)
  const isMarkdown = isMarkdownFile(file)
  const isCsv = isCsvFile(file)
  const markdownContent = useMemo(() => parseMarkdownContent(draftContent), [draftContent])
  const csvRows = useMemo(() => parseCsvRows(draftContent), [draftContent])
  const filePath = file?.path
  const fileHash = file?.hash
  const editorInstanceKey = `${selectedVersionId ?? 'draft'}:${filePath ?? 'empty'}:${readonly ? 'readonly' : 'draft'}`
  const referenceTargets = useMemo(
    () => getReferenceTargets(detail?.files ?? [], filePath),
    [detail?.files, filePath],
  )
  const referenceQuery = referencePicker?.query.trim().toLowerCase() ?? ''
  const filteredReferenceFiles = useMemo(() => {
    const currentDirectory = referencePicker?.currentDirectory ?? ''
    const scopedTargets = referenceTargets.filter((referenceFile) => {
      const parentDirectory = getPathDirName(referenceFile.path)
      return parentDirectory === currentDirectory
    })
    if (!referenceQuery) return scopedTargets

    return scopedTargets.filter((referenceFile) => {
      const path = referenceFile.path.toLowerCase()
      return path.includes(referenceQuery) || getPathBaseName(path).includes(referenceQuery)
    })
  }, [referencePicker?.currentDirectory, referenceQuery, referenceTargets])

  useEffect(() => {
    setDisplayNameDraft(markdownContent.displayName)
  }, [markdownContent.displayName])
  const shouldFetchTextFileContent = !!file && isTextFile(file) && file.content == null
  const textContentQuery = useQuery({
    queryKey: ['skill-file-text-content', skillId, selectedVersionId, filePath, fileHash],
    queryFn: async () => {
      if (!filePath) throw new Error('file path is required')
      const blob = await fetchSkillFileBlob({
        path: filePath,
        skillId,
        versionId: selectedVersionId,
      })
      return blob.text()
    },
    enabled: shouldFetchTextFileContent,
  })
  const canPreviewBinaryFile =
    !!file && !isTextFile(file) && (isSkillImageFile(file) || isSkillPdfFile(file))
  const binaryPreviewQuery = useQuery({
    queryKey: ['skill-file-blob-preview', skillId, selectedVersionId, filePath, fileHash],
    queryFn: () => {
      if (!filePath) throw new Error('file path is required')
      return fetchSkillFileBlob({
        path: filePath,
        skillId,
        versionId: selectedVersionId,
      })
    },
    enabled: canPreviewBinaryFile,
  })
  const fileObjectUrl = useMemo(
    () => (binaryPreviewQuery.data ? URL.createObjectURL(binaryPreviewQuery.data) : undefined),
    [binaryPreviewQuery.data],
  )
  const downloadMutation = useMutation({
    mutationFn: () => {
      if (!filePath) throw new Error('file path is required')
      return fetchSkillFileBlob({
        download: true,
        path: filePath,
        skillId,
        versionId: selectedVersionId,
      })
    },
    onSuccess: (blob) => {
      if (!file) return
      downloadBlob({ data: blob, fileName: getPathBaseName(file.path) })
    },
    onError: () => {
      toast.error(t(($) => $['skillManagement.detail.loadFailed']))
    },
  })

  const saveDraftContent = useCallback(
    async (content: string) => {
      if (!detail || !file || !canEdit || isSavingDraft) return false

      setSaveStatus('saving')
      try {
        const nextDetail = await saveDraftFile({
          params: {
            skill_id: skillId,
          },
          body: {
            content,
            expected_updated_at: detail.updated_at,
            hash: file.hash,
            mime_type: file.mime_type,
            operation: 'upsert_text',
            path: file.path,
            size: content.length,
          },
        })
        const nextDisplayName =
          file.path === 'SKILL.md' ? parseMarkdownContent(content).displayName.trim() : ''
        const nextCachedDetail =
          nextDisplayName && nextDisplayName !== nextDetail.display_name
            ? {
                ...nextDetail,
                ...(await updateSkillMetadata({
                  params: {
                    skill_id: skillId,
                  },
                  body: {
                    display_name: nextDisplayName,
                    expected_updated_at: nextDetail.updated_at,
                  },
                })),
                files: nextDetail.files,
              }
            : nextDetail

        lastSavedContentRef.current = content
        setSavedAt(nextCachedDetail.updated_at * 1000)
        setSaveStatus(draftContentRef.current === content ? 'saved' : 'dirty')
        setSkillDetailCache(queryClient, skillId, nextCachedDetail)
        return true
      } catch {
        setSaveStatus('error')
        toast.error(t(($) => $['skillManagement.detail.saveFailed']))
        return false
      }
    },
    [
      canEdit,
      detail,
      file,
      isSavingDraft,
      queryClient,
      saveDraftFile,
      skillId,
      t,
      updateSkillMetadata,
    ],
  )

  fileRef.current = file

  useEffect(() => {
    const currentFile = fileRef.current
    const nextContent = currentFile && isTextFile(currentFile) ? (currentFile.content ?? '') : ''

    draftContentRef.current = nextContent
    lastSavedContentRef.current = nextContent
    setDraftContent(nextContent)
    setSaveStatus('saved')
    setMetadataAdding(false)
    setMetadataKey('')
    setMetadataValue('')
    setReferencePicker(null)
  }, [editorInstanceKey])

  useEffect(() => {
    if (!shouldFetchTextFileContent || textContentQuery.data == null) return

    draftContentRef.current = textContentQuery.data
    lastSavedContentRef.current = textContentQuery.data
    setDraftContent(textContentQuery.data)
    setSaveStatus('saved')
  }, [shouldFetchTextFileContent, textContentQuery.data])

  useEffect(() => {
    if (!canEdit) return
    if (draftContent === lastSavedContentRef.current) return
    if (saveStatus === 'saving') return

    const timer = window.setTimeout(() => {
      void saveDraftContent(draftContent)
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [canEdit, draftContent, saveDraftContent, saveStatus])

  useEffect(() => {
    return () => {
      if (!canEdit) return
      if (draftContentRef.current === lastSavedContentRef.current) return

      void saveDraftContent(draftContentRef.current)
    }
  }, [canEdit, saveDraftContent])

  useEffect(() => {
    return () => {
      if (fileObjectUrl) URL.revokeObjectURL(fileObjectUrl)
    }
  }, [fileObjectUrl])

  useEffect(() => {
    if (referencePicker?.query == null) return
    setReferenceSelectedIndex(0)
  }, [referencePicker?.currentDirectory, referencePicker?.query])

  useEffect(() => {
    if (referenceSelectedIndex < filteredReferenceFiles.length) return
    setReferenceSelectedIndex(Math.max(filteredReferenceFiles.length - 1, 0))
  }, [filteredReferenceFiles.length, referenceSelectedIndex])

  const updateDraftContent = (nextContent: string) => {
    draftContentRef.current = nextContent
    setDraftContent(nextContent)
    setSaveStatus(nextContent === lastSavedContentRef.current ? 'saved' : 'dirty')
  }

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextContent = event.target.value
    updateDraftContent(nextContent)

    if (!referencePicker) return

    const caretIndex = event.target.selectionStart
    if (
      caretIndex <= referencePicker.slashIndex ||
      nextContent[referencePicker.slashIndex] !== '/' ||
      nextContent.slice(referencePicker.slashIndex + 1, caretIndex).includes('\n')
    ) {
      setReferencePicker(null)
      return
    }

    setReferencePicker({
      anchor: getTextareaCaretAnchor(event.target, caretIndex),
      currentDirectory: referencePicker.currentDirectory,
      slashIndex: referencePicker.slashIndex,
      query: nextContent.slice(referencePicker.slashIndex + 1, caretIndex),
    })
  }

  const handleLiveBodyEditorInput = (event: FormEvent<HTMLDivElement>) => {
    const nextBody = serializeMarkdownLiveEditorNode(event.currentTarget).replace(/\u00A0/g, ' ')
    const nextCaretOffset = getMarkdownLiveEditorSelectionOffset(event.currentTarget)
    const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
    updateDraftContent(nextContent)
    if (nextCaretOffset != null) {
      window.requestAnimationFrame(() => {
        if (!liveBodyEditorRef.current) return

        liveBodyEditorRef.current.focus()
        setMarkdownLiveEditorSelectionOffset(liveBodyEditorRef.current, nextCaretOffset)
      })
    }

    if (!referencePicker) return

    const bodyPrefixLength = getMarkdownBodyPrefix(nextContent).length
    const bodyCaretIndex = getMarkdownLiveEditorSelectionOffset(event.currentTarget) ?? 0
    const caretIndex = bodyPrefixLength + bodyCaretIndex
    if (
      caretIndex <= referencePicker.slashIndex ||
      nextContent[referencePicker.slashIndex] !== '/' ||
      nextContent.slice(referencePicker.slashIndex + 1, caretIndex).includes('\n')
    ) {
      setReferencePicker(null)
      return
    }

    setReferencePicker({
      anchor: getContentEditableCaretAnchor(event.currentTarget),
      currentDirectory: referencePicker.currentDirectory,
      slashIndex: referencePicker.slashIndex,
      query: nextContent.slice(referencePicker.slashIndex + 1, caretIndex),
    })
  }

  const handleReferenceDirectoryBack = () => {
    if (!referencePicker?.currentDirectory) return

    setReferencePicker({
      anchor: referencePicker.anchor,
      currentDirectory: getPathDirName(referencePicker.currentDirectory),
      slashIndex: referencePicker.slashIndex,
      query: '',
    })
  }

  const handleReferenceDirectoryOpen = (directory: SkillFileResponse) => {
    if (!referencePicker || !isDirectory(directory)) return

    setReferencePicker({
      anchor: referencePicker.anchor,
      currentDirectory: directory.path,
      slashIndex: referencePicker.slashIndex,
      query: '',
    })
  }

  const handleTextEditorKeyDown = (
    event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>,
    bodyMode = false,
  ) => {
    if (!isMarkdown || readonly) return

    if (
      bodyMode &&
      event.currentTarget instanceof HTMLTextAreaElement &&
      event.key === 'Backspace' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const caretIndex = event.currentTarget.selectionStart
      if (event.currentTarget.value[caretIndex - 1] === '\n') {
        event.preventDefault()

        const nextCaretIndex = caretIndex - 1
        const nextBody = `${event.currentTarget.value.slice(0, nextCaretIndex)}${event.currentTarget.value.slice(caretIndex)}`
        const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
        updateDraftContent(nextContent)
        window.requestAnimationFrame(() => {
          liveBodyTextareaRef.current?.focus()
          liveBodyTextareaRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex)
        })
        return
      }

      const referenceRange =
        findMarkdownReferenceRangeAtCaret(event.currentTarget.value, caretIndex) ??
        findBrokenMarkdownReferenceRangeAtCaret(event.currentTarget.value, caretIndex)
      if (referenceRange) {
        event.preventDefault()

        const nextBody = `${event.currentTarget.value.slice(0, referenceRange.start)}${event.currentTarget.value.slice(referenceRange.end)}`
        const nextContent = replaceMarkdownBody(draftContentRef.current, nextBody)
        updateDraftContent(nextContent)
        window.requestAnimationFrame(() => {
          liveBodyTextareaRef.current?.focus()
          liveBodyTextareaRef.current?.setSelectionRange(referenceRange.start, referenceRange.start)
        })
        return
      }
    }

    if (referencePicker) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setReferencePicker(null)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setReferenceSelectedIndex((index) =>
          Math.min(index + 1, Math.max(filteredReferenceFiles.length - 1, 0)),
        )
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (referenceSelectedIndex === 0 && referencePicker.currentDirectory) {
          handleReferenceDirectoryBack()
          return
        }
        setReferenceSelectedIndex((index) => Math.max(index - 1, 0))
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleReferenceDirectoryBack()
        return
      }

      if (event.key === 'ArrowRight') {
        const selectedFile = filteredReferenceFiles[referenceSelectedIndex]
        if (!selectedFile || !isDirectory(selectedFile)) return

        event.preventDefault()
        handleReferenceDirectoryOpen(selectedFile)
        return
      }

      if (event.key === 'Enter') {
        const selectedFile = filteredReferenceFiles[referenceSelectedIndex]
        if (!selectedFile) return

        event.preventDefault()
        if (isDirectory(selectedFile)) {
          handleReferenceDirectoryOpen(selectedFile)
          return
        }

        // oxlint-disable-next-line typescript/no-use-before-define -- Reference insertion reads current picker state and is kept beside its write logic.
        handleInsertReferenceFile(selectedFile, bodyMode)
        return
      }
    }

    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return

    const bodyPrefixLength = bodyMode ? getMarkdownBodyPrefix(draftContentRef.current).length : 0
    const bodySelectionStart =
      event.currentTarget instanceof HTMLTextAreaElement
        ? event.currentTarget.selectionStart
        : getMarkdownLiveEditorSelectionOffset(event.currentTarget)
    if (bodySelectionStart == null) return

    setReferencePicker({
      anchor:
        event.currentTarget instanceof HTMLTextAreaElement
          ? getTextareaCaretAnchor(event.currentTarget, bodySelectionStart)
          : getContentEditableCaretAnchor(event.currentTarget),
      currentDirectory: '',
      slashIndex: bodyPrefixLength + bodySelectionStart,
      query: '',
    })
    setReferenceSelectedIndex(0)
  }

  const handleInsertReferenceFile = (referenceFile: SkillFileResponse, bodyMode = false) => {
    if (!referencePicker) return

    if (bodyMode && liveBodyEditorRef.current) {
      const bodyPrefixLength = getMarkdownBodyPrefix(draftContentRef.current).length
      const bodyCaretIndex =
        getMarkdownLiveEditorSelectionOffset(liveBodyEditorRef.current) ??
        referencePicker.slashIndex - bodyPrefixLength + referencePicker.query.length + 1
      const replaceEnd = bodyPrefixLength + bodyCaretIndex
      const referenceText = `${getReferenceText(referenceFile)}\n`
      const nextContent = `${draftContentRef.current.slice(0, referencePicker.slashIndex)}${referenceText}${draftContentRef.current.slice(replaceEnd)}`
      const nextBody = nextContent.slice(bodyPrefixLength)

      updateDraftContent(nextContent)
      setReferencePicker(null)
      window.requestAnimationFrame(() => {
        const editor = liveBodyEditorRef.current
        if (!editor) return

        renderMarkdownLiveEditorContent(editor, nextBody)
        editor.focus()
        setMarkdownLiveEditorSelectionOffset(
          editor,
          referencePicker.slashIndex - bodyPrefixLength + referenceText.length,
        )
      })
      return
    }

    const textarea = bodyMode ? liveBodyTextareaRef.current : sourceTextareaRef.current
    const bodyPrefixLength = bodyMode ? getMarkdownBodyPrefix(draftContentRef.current).length : 0
    const replaceEnd =
      (textarea?.selectionStart ?? referencePicker.slashIndex + referencePicker.query.length + 1) +
      bodyPrefixLength
    const referenceText = bodyMode
      ? `${getReferenceText(referenceFile)}\n`
      : getReferenceText(referenceFile)
    const nextContent = `${draftContentRef.current.slice(0, referencePicker.slashIndex)}${referenceText}${draftContentRef.current.slice(replaceEnd)}`
    const nextCaretIndex = referencePicker.slashIndex + referenceText.length
    const textareaCaretIndex = bodyMode ? nextCaretIndex - bodyPrefixLength : nextCaretIndex

    updateDraftContent(nextContent)
    setReferencePicker(null)
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(textareaCaretIndex, textareaCaretIndex)
    })
  }

  const trimmedMetadataKey = metadataKey.trim()
  const canAddMetadata =
    isEditableMetadataKey(trimmedMetadataKey) && !isProtectedMarkdownMetadataKey(trimmedMetadataKey)

  const handleAddMetadata = () => {
    if (!canAddMetadata) return

    updateDraftContent(
      addMarkdownMetadata(draftContentRef.current, trimmedMetadataKey, metadataValue),
    )
    setMetadataKey('')
    setMetadataValue('')
    setMetadataAdding(false)
  }

  const handleDisplayNameCommit = () => {
    if (readonly || displayNameDraft === markdownContent.displayName) return

    updateDraftContent(setMarkdownDisplayName(draftContentRef.current, displayNameDraft))
  }

  const handleRemoveMetadata = (key: string) => {
    updateDraftContent(removeMarkdownMetadata(draftContentRef.current, key))
  }

  const handleCancelAddMetadata = () => {
    setMetadataKey('')
    setMetadataValue('')
    setMetadataAdding(false)
  }

  const handlePublish = async () => {
    if (publishing) return

    let contentToPublish = draftContentRef.current
    if (canEdit && displayNameDraft !== markdownContent.displayName) {
      contentToPublish = setMarkdownDisplayName(contentToPublish, displayNameDraft)
      updateDraftContent(contentToPublish)
    }

    if (canEdit && contentToPublish !== lastSavedContentRef.current) {
      const saved = await saveDraftContent(contentToPublish)
      if (!saved) return
    }

    if ((detail?.reference_count ?? 0) > 0) {
      setPublishConfirmOpen(true)
      return
    }

    onPublish()
  }

  const saveStateText =
    saveStatus === 'saving'
      ? t(($) => $['skillManagement.detail.saving'])
      : saveStatus === 'dirty'
        ? t(($) => $['skillManagement.detail.unsavedChanges'])
        : saveStatus === 'error'
          ? t(($) => $['skillManagement.detail.saveFailed'])
          : savedAt
            ? t(($) => $['skillManagement.detail.savedAt'], { time: formatTimeFromNow(savedAt) })
            : t(($) => $['skillManagement.detail.saved'])

  if (!selectedPath) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['skillManagement.detail.noFileSelected'])}
        </p>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['skillManagement.detail.fileMissing'])}
        </p>
      </div>
    )
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden border-r border-divider-subtle bg-background-default">
      <div className="flex h-12 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-divider-subtle px-2">
        <div className="flex w-max min-w-full items-stretch">
          {openFiles.map((openFile) => {
            const selected = openFile.path === selectedPath

            return (
              <div
                key={openFile.path}
                className={cn(
                  'group/tab flex h-12 w-44 shrink-0 items-center gap-2 border-r border-divider-subtle px-3',
                  selected ? 'bg-background-default' : 'bg-background-section',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => onSelectFile(openFile.path)}
                >
                  <span
                    aria-hidden
                    className={cn('size-4 shrink-0', getSkillFileIconClass(openFile))}
                  />
                  <span
                    className={cn(
                      'truncate system-sm-medium',
                      selected ? 'text-text-primary' : 'text-text-tertiary',
                    )}
                  >
                    {getPathBaseName(openFile.path)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t(($) => $['skillManagement.detail.closeFileTab'], {
                    name: openFile.path,
                  })}
                  className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-quaternary opacity-0 outline-hidden group-hover/tab:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => onCloseFile(openFile.path)}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 p-3 pb-20">
        {isMarkdown && markdownMode === 'live' ? (
          <div className="relative h-full overflow-hidden rounded-xl border border-divider-regular bg-background-default">
            <MarkdownModeSwitch mode={markdownMode} onChange={setMarkdownMode} />
            <div className="h-full overflow-y-auto px-8 py-10">
              <div className="mx-auto max-w-[820px]">
                {(markdownContent.name ||
                  markdownContent.description ||
                  markdownContent.displayName ||
                  markdownContent.metadata.length > 0 ||
                  !readonly) && (
                  <div className="mb-8 space-y-5">
                    {markdownContent.name && (
                      <div className="max-w-full space-y-1">
                        <div className="system-sm-regular text-text-tertiary">name</div>
                        <div className="max-w-[320px] truncate system-sm-regular text-text-secondary">
                          {markdownContent.name}
                        </div>
                      </div>
                    )}
                    {markdownContent.description && (
                      <div className="max-w-full space-y-1">
                        <div className="system-sm-regular text-text-tertiary">description</div>
                        <div className="max-w-[520px] system-sm-regular break-words whitespace-pre-wrap text-text-secondary">
                          {markdownContent.description}
                        </div>
                      </div>
                    )}
                    {(markdownContent.displayName || !readonly) && (
                      <div className="max-w-full space-y-1">
                        <div className="system-sm-regular text-text-tertiary">display-name</div>
                        {readonly ? (
                          <div className="max-w-[320px] truncate system-sm-regular text-text-secondary">
                            {markdownContent.displayName || '-'}
                          </div>
                        ) : (
                          <input
                            value={displayNameDraft}
                            placeholder={detail?.display_name ?? ''}
                            className="h-8 w-[280px] max-w-full rounded-lg border border-transparent bg-transparent px-0 system-sm-regular text-text-secondary outline-hidden placeholder:text-text-quaternary hover:border-divider-regular hover:bg-background-default hover:px-2.5 focus-visible:border-divider-regular focus-visible:bg-background-default focus-visible:px-2.5 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                            onBlur={handleDisplayNameCommit}
                            onChange={(event) => {
                              const nextDisplayName = event.target.value
                              setDisplayNameDraft(nextDisplayName)
                              updateDraftContent(
                                setMarkdownDisplayName(draftContentRef.current, nextDisplayName),
                              )
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                setDisplayNameDraft(markdownContent.displayName)
                                event.currentTarget.blur()
                                return
                              }
                              if (event.key !== 'Enter') return

                              event.preventDefault()
                              handleDisplayNameCommit()
                              event.currentTarget.blur()
                            }}
                          />
                        )}
                      </div>
                    )}
                    {markdownContent.metadata.map((entry) => {
                      const removable = !readonly && !isProtectedMarkdownMetadataKey(entry.key)

                      return (
                        <div key={entry.key} className="max-w-full space-y-1">
                          <div className="flex w-fit max-w-full items-center gap-1">
                            <div className="min-w-0 truncate system-sm-regular text-text-tertiary">
                              {entry.key}
                            </div>
                            {removable && (
                              <button
                                type="button"
                                aria-label={t(($) => $['skillManagement.detail.removeMetadata'], {
                                  name: entry.key,
                                })}
                                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                                onClick={() => handleRemoveMetadata(entry.key)}
                              >
                                <span aria-hidden className="i-ri-delete-bin-line size-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="max-w-[320px] truncate system-sm-regular text-text-secondary">
                            {entry.value || '-'}
                          </div>
                        </div>
                      )
                    })}
                    {!readonly && metadataAdding && (
                      <div className="w-[280px] max-w-full space-y-3">
                        <div className="flex items-center gap-1">
                          <input
                            value={metadataKey}
                            placeholder={t(($) => $['skillManagement.detail.metadataKey'])}
                            className={metadataInputClassName}
                            onChange={(event) => setMetadataKey(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') handleCancelAddMetadata()
                            }}
                          />
                          <button
                            type="button"
                            aria-label={t(($) => $['skillManagement.detail.cancelAddMetadata'])}
                            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                            onClick={handleCancelAddMetadata}
                          >
                            <span aria-hidden className="i-ri-delete-bin-line size-4" />
                          </button>
                        </div>
                        <input
                          value={metadataValue}
                          placeholder={t(($) => $['skillManagement.detail.metadataValue'])}
                          className={metadataInputClassName}
                          onChange={(event) => setMetadataValue(event.target.value)}
                          onKeyDownCapture={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.stopPropagation()
                              handleAddMetadata()
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') handleCancelAddMetadata()
                          }}
                          onKeyUp={(event) => {
                            if (event.key !== 'Enter') return
                            event.preventDefault()
                            event.stopPropagation()
                            handleAddMetadata()
                          }}
                        />
                      </div>
                    )}
                    {!readonly && !metadataAdding && (
                      <button
                        type="button"
                        className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 system-sm-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                        onClick={() => setMetadataAdding(true)}
                      >
                        <span aria-hidden className="i-ri-add-line size-4" />
                        {t(($) => $['skillManagement.detail.addMetadata'])}
                      </button>
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    markdownContent.metadata.length > 0 && 'border-t border-divider-subtle pt-8',
                  )}
                >
                  {readonly ? (
                    <MarkdownBodyReferencePreview
                      body={markdownContent.body}
                      className="min-h-[360px]"
                      placeholder={t(
                        ($) => $['skillManagement.detail.referenceFiles.livePlaceholder'],
                      )}
                    />
                  ) : (
                    <div className="relative min-h-[360px]">
                      <MarkdownLiveBodyEditor
                        body={markdownContent.body}
                        editorRef={liveBodyEditorRef}
                        placeholder={t(
                          ($) => $['skillManagement.detail.referenceFiles.livePlaceholder'],
                        )}
                        onInput={handleLiveBodyEditorInput}
                        onKeyDown={(event) => handleTextEditorKeyDown(event, true)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {referencePicker && (
              <ReferenceFilesPicker
                files={filteredReferenceFiles}
                query={referenceQuery}
                selectedIndex={referenceSelectedIndex}
                title={t(($) => $['skillManagement.detail.referenceFiles.title'])}
                emptyText={t(($) => $['skillManagement.detail.referenceFiles.empty'])}
                navigateText={t(($) => $['skillManagement.detail.referenceFiles.navigate'])}
                confirmText={t(($) => $['skillManagement.detail.referenceFiles.confirm'])}
                currentDirectory={referencePicker.currentDirectory}
                anchor={referencePicker.anchor}
                onBack={handleReferenceDirectoryBack}
                onSelectIndex={setReferenceSelectedIndex}
                onSelect={(referenceFile) => {
                  if (isDirectory(referenceFile)) {
                    handleReferenceDirectoryOpen(referenceFile)
                    return
                  }

                  handleInsertReferenceFile(referenceFile, true)
                }}
              />
            )}
          </div>
        ) : isMarkdown ? (
          <div className="relative h-full">
            <MarkdownModeSwitch mode={markdownMode} onChange={setMarkdownMode} />
            <textarea
              ref={sourceTextareaRef}
              key={editorInstanceKey}
              readOnly={readonly}
              value={draftContent}
              spellCheck={false}
              className="h-full w-full resize-none rounded-xl border border-divider-regular bg-background-default p-4 pr-24 font-mono text-[13px]/[20px] text-text-secondary outline-hidden read-only:bg-background-section focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onChange={handleContentChange}
              onKeyDown={(event) => handleTextEditorKeyDown(event)}
            />
            {textContentQuery.isError && (
              <div className="absolute top-14 right-3 rounded-lg border border-divider-regular bg-components-panel-bg px-3 py-2 shadow-lg">
                <p className="system-xs-regular text-text-tertiary">
                  {t(($) => $['skillManagement.detail.loadFailed'])}
                </p>
              </div>
            )}
            {referencePicker && (
              <ReferenceFilesPicker
                files={filteredReferenceFiles}
                query={referenceQuery}
                selectedIndex={referenceSelectedIndex}
                title={t(($) => $['skillManagement.detail.referenceFiles.title'])}
                emptyText={t(($) => $['skillManagement.detail.referenceFiles.empty'])}
                navigateText={t(($) => $['skillManagement.detail.referenceFiles.navigate'])}
                confirmText={t(($) => $['skillManagement.detail.referenceFiles.confirm'])}
                currentDirectory={referencePicker.currentDirectory}
                anchor={referencePicker.anchor}
                onBack={handleReferenceDirectoryBack}
                onSelectIndex={setReferenceSelectedIndex}
                onSelect={(referenceFile) => {
                  if (isDirectory(referenceFile)) {
                    handleReferenceDirectoryOpen(referenceFile)
                    return
                  }

                  handleInsertReferenceFile(referenceFile)
                }}
              />
            )}
          </div>
        ) : codeLanguage ? (
          <div className="h-full overflow-hidden rounded-xl border border-divider-regular bg-background-default">
            <CodeEditor
              key={editorInstanceKey}
              language={codeLanguage}
              value={draftContent}
              readOnly={readonly}
              noWrapper
              isExpand
              className="h-full"
              onChange={updateDraftContent}
            />
          </div>
        ) : isTextFile(file) && textContentQuery.isPending ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-divider-regular bg-background-default">
            <SkeletonRectangle className="h-full w-full rounded-lg" />
          </div>
        ) : isTextFile(file) && textContentQuery.isError ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default">
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.loadFailed'])}
            </p>
          </div>
        ) : isCsv ? (
          <CsvTablePreview rows={csvRows} />
        ) : isTextFile(file) ? (
          <div className="relative h-full">
            <textarea
              ref={sourceTextareaRef}
              key={editorInstanceKey}
              readOnly={readonly}
              value={draftContent}
              spellCheck={false}
              className={cn(
                'h-full w-full resize-none rounded-xl border border-divider-regular bg-background-default p-4 font-mono text-[13px]/[20px] text-text-secondary outline-hidden read-only:bg-background-section focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              )}
              onChange={handleContentChange}
              onKeyDown={(event) => handleTextEditorKeyDown(event)}
            />
            {referencePicker && (
              <ReferenceFilesPicker
                files={filteredReferenceFiles}
                query={referenceQuery}
                selectedIndex={referenceSelectedIndex}
                title={t(($) => $['skillManagement.detail.referenceFiles.title'])}
                emptyText={t(($) => $['skillManagement.detail.referenceFiles.empty'])}
                navigateText={t(($) => $['skillManagement.detail.referenceFiles.navigate'])}
                confirmText={t(($) => $['skillManagement.detail.referenceFiles.confirm'])}
                currentDirectory={referencePicker.currentDirectory}
                anchor={referencePicker.anchor}
                onBack={handleReferenceDirectoryBack}
                onSelectIndex={setReferenceSelectedIndex}
                onSelect={(referenceFile) => {
                  if (isDirectory(referenceFile)) {
                    handleReferenceDirectoryOpen(referenceFile)
                    return
                  }

                  handleInsertReferenceFile(referenceFile)
                }}
              />
            )}
          </div>
        ) : canPreviewBinaryFile && binaryPreviewQuery.isPending ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-divider-regular bg-background-default">
            <SkeletonRectangle className="h-full w-full rounded-lg" />
          </div>
        ) : canPreviewBinaryFile && binaryPreviewQuery.isError ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default">
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.loadFailed'])}
            </p>
          </div>
        ) : isSkillImageFile(file) && fileObjectUrl ? (
          <div className="flex h-full items-center justify-center overflow-hidden rounded-xl border border-divider-regular bg-background-section p-4">
            <img
              src={fileObjectUrl}
              alt={file.path}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        ) : isSkillPdfFile(file) && fileObjectUrl ? (
          <iframe
            src={fileObjectUrl}
            title={file.path}
            className="h-full w-full rounded-xl border border-divider-regular bg-background-default"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider-regular bg-background-default">
            <div className="flex flex-col items-center gap-2 text-center">
              <span aria-hidden className={cn('size-8', getSkillFileIconClass(file))} />
              <p className="system-sm-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.previewUnsupported'])}
              </p>
              <p className="system-xs-regular text-text-quaternary">
                {t(($) => $['skillManagement.detail.fileMeta'], {
                  size: file.size ?? 0,
                  type: file.mime_type ?? file.kind,
                })}
              </p>
              <Button
                variant="secondary"
                className="mt-2 h-8 px-3"
                loading={downloadMutation.isPending}
                onClick={() => downloadMutation.mutate()}
              >
                <span aria-hidden className="i-ri-download-line size-4" />
                {t(($) => $['skillManagement.detail.downloadFile'])}
              </Button>
            </div>
          </div>
        )}
      </div>
      {!readonly && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
          <div className="pointer-events-auto relative flex h-12 max-w-[calc(100%-2rem)] min-w-[412px] items-center gap-3 rounded-xl border border-divider-subtle bg-background-default px-4 shadow-xl">
            <SkillPublishConfirmPanel
              loading={publishing}
              onCancel={() => setPublishConfirmOpen(false)}
              onConfirm={() => {
                setPublishConfirmOpen(false)
                onPublish()
              }}
              open={publishConfirmOpen}
              referenceCount={detail?.reference_count ?? 0}
              skillId={skillId}
            />
            <span aria-hidden className="size-1.5 rounded-[2px] bg-text-tertiary" />
            <span className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary">
              {t(($) => $['skillManagement.detail.draft'])}
              <span className="px-1">·</span>
              {saveStateText}
            </span>
            <button
              type="button"
              aria-label={t(($) => $['skillManagement.detail.versionHistory'])}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={onOpenVersions}
            >
              <span aria-hidden className="i-ri-history-line size-4" />
            </button>
            <Button
              variant="primary"
              className="h-8 px-4"
              loading={publishing || saveStatus === 'saving'}
              disabled={saveStatus === 'saving'}
              onClick={handlePublish}
            >
              {t(($) => $['skillManagement.detail.publish'])}
            </Button>
          </div>
        </div>
      )}
      {readonly && selectedVersion && (
        <VersionActionBar
          version={selectedVersion}
          restoring={publishing}
          onRestore={onRestoreVersion}
          onExit={onExitVersion}
        />
      )}
    </main>
  )
}

function VersionRow({
  onSelect,
  selected,
  skillId,
  version,
}: {
  onSelect: (versionId: string | null) => void
  selected: boolean
  skillId: string
  version: SkillVersionResponse
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [versionName, setVersionName] = useState(version.version_name)
  const [publishNote, setPublishNote] = useState(version.publish_note)
  const renameMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.patch.mutationOptions(),
  )
  const restoreMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.restore.post.mutationOptions(),
  )
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.delete.mutationOptions(),
  )
  const publishedBy = version.published_by_name ?? version.published_by ?? '-'
  const versionInfoLabel = version.is_latest
    ? t(($) => $['skillManagement.detail.editVersionInfo'])
    : t(($) => $['skillManagement.detail.nameThisVersion'])

  const invalidateVersions = () => invalidateSkillDetail(queryClient, skillId)

  const handleRename = () => {
    const trimmedName = versionName.trim()
    if (!trimmedName) return

    renameMutation.mutate(
      {
        params: {
          skill_id: skillId,
          version_id: version.id,
        },
        body: {
          publish_note: publishNote,
          version_name: trimmedName,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.detail.renameVersionSuccess']))
          setRenameOpen(false)
          invalidateVersions()
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.renameVersionFailed']))
        },
      },
    )
  }

  const handleRestore = () => {
    restoreMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {
          version_id: version.id,
          version_name: version.version_name,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.detail.restoreVersionSuccess']))
          invalidateVersions()
          onSelect(null)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.restoreVersionFailed']))
        },
      },
    )
  }

  const handleCopyId = () => {
    copy(version.id)
    toast.success(t(($) => $['skillManagement.detail.copyVersionIdSuccess']))
  }

  const handleDelete = () => {
    deleteMutation.mutate(
      {
        params: {
          skill_id: skillId,
          version_id: version.id,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.detail.deleteVersionSuccess']))
          setDeleteOpen(false)
          invalidateVersions()
          onSelect(null)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.deleteVersionFailed']))
        },
      },
    )
  }

  return (
    <>
      <li>
        <div
          className={cn(
            'flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-state-base-hover',
            selected && 'bg-state-base-hover',
          )}
        >
          <span
            aria-hidden
            className="mt-0.5 i-ri-git-commit-line size-4 shrink-0 text-text-tertiary"
          />
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => onSelect(version.id)}
          >
            <span className="block min-w-0">
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className={cn(
                    'truncate system-xs-semibold',
                    selected ? 'text-text-accent' : 'text-text-secondary',
                  )}
                >
                  {version.version_name}
                </span>
                {version.is_latest && (
                  <span className="shrink-0 rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-accent-secondary">
                    {t(($) => $['skillManagement.detail.latest'])}
                  </span>
                )}
              </span>
              {version.publish_note && (
                <span className="mt-0.5 block system-xs-regular break-words text-text-secondary">
                  {version.publish_note}
                </span>
              )}
              <span className="mt-0.5 block truncate system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.versionPublishedMeta'], {
                  name: publishedBy,
                  time: formatTime(
                    version.created_at,
                    t(($) => $['skillManagement.dateTimeFormat']),
                  ),
                })}
              </span>
            </span>
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover">
              <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
            </DropdownMenuTrigger>
            <DropdownMenuContent placement="bottom-end" popupClassName="w-40">
              <DropdownMenuItem className="gap-2" onClick={handleRestore}>
                <span aria-hidden className="i-ri-history-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.restoreVersion'])}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onClick={() => {
                  setVersionName(version.version_name)
                  setPublishNote(version.publish_note)
                  setRenameOpen(true)
                }}
              >
                <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                <span>{versionInfoLabel}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={handleCopyId}>
                <span aria-hidden className="i-ri-file-copy-line size-4 text-text-tertiary" />
                <span>{t(($) => $['skillManagement.detail.copyVersionId'])}</span>
              </DropdownMenuItem>
              {!version.is_latest && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="gap-2"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4" />
                    <span>{tCommon(($) => $['operation.delete'])}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="w-full max-w-[480px] overflow-hidden! border-none p-0 text-left align-middle">
          <DialogCloseButton />
          <div className="px-6 pt-6 pr-14 pb-4">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {versionInfoLabel}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['skillManagement.detail.renameVersionPrompt'])}
            </DialogDescription>
          </div>
          <div className="flex flex-col gap-y-4 px-6 py-3">
            <Field name="versionTitle" className="gap-y-1">
              <FieldLabel className="flex h-6 items-center py-0 system-sm-semibold text-text-secondary">
                {t(($) => $['skillManagement.detail.versionTitle'])}
              </FieldLabel>
              <FieldControl
                value={versionName}
                placeholder={t(($) => $['skillManagement.detail.nameThisVersion'])}
                onValueChange={setVersionName}
              />
            </Field>
            <Field name="publishNote" className="gap-y-1">
              <FieldLabel className="flex h-6 items-center py-0 system-sm-semibold text-text-secondary">
                {t(($) => $['skillManagement.detail.versionPublishNote'])}
              </FieldLabel>
              <Textarea
                value={publishNote}
                placeholder={t(($) => $['skillManagement.detail.versionPublishNotePlaceholder'])}
                onValueChange={setPublishNote}
              />
            </Field>
          </div>
          <div className="flex justify-end p-6 pt-5">
            <div className="flex items-center gap-x-3">
              <Button disabled={renameMutation.isPending} onClick={() => setRenameOpen(false)}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                variant="primary"
                loading={renameMutation.isPending}
                disabled={!versionName.trim()}
                onClick={handleRename}
              >
                {t(($) => $['skillManagement.detail.publish'])}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="p-6">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['skillManagement.detail.deleteVersionConfirm'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 system-md-regular text-text-tertiary">
            {version.version_name}
          </AlertDialogDescription>
          <AlertDialogActions className="p-0 pt-6">
            <AlertDialogCancelButton disabled={deleteMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function VersionPanel({
  onClose,
  onSelect,
  selectedVersionId,
  skillId,
  versions,
}: {
  onClose: () => void
  onSelect: (versionId: string | null) => void
  selectedVersionId: string | null
  skillId: string
  versions: SkillVersionResponse[]
}) {
  const { t } = useTranslation('agentV2')

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden bg-background-default">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-divider-subtle px-5">
        <h2 className="system-sm-semibold text-text-secondary">
          {t(($) => $['skillManagement.detail.versions'])}
        </h2>
        <div className="flex items-center gap-1">
          {selectedVersionId && (
            <Button className="h-7 px-2" onClick={() => onSelect(null)}>
              {t(($) => $['skillManagement.detail.currentDraft'])}
            </Button>
          )}
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.closeVersions'])}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onClose}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </div>
      <ScrollAreaRoot className="min-h-0 flex-1 overflow-hidden">
        <ScrollAreaViewport tabIndex={-1}>
          <ScrollAreaContent className="p-2">
            {versions.length === 0 ? (
              <p className="px-2 py-3 system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.noVersions'])}
              </p>
            ) : (
              <ul className="space-y-1">
                {versions.map((version) => (
                  <VersionRow
                    key={version.id}
                    version={version}
                    skillId={skillId}
                    selected={selectedVersionId === version.id}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </aside>
  )
}

function BuilderModelSelector({
  isLoading,
  modelList,
  selectedModel,
  onSelect,
}: {
  isLoading: boolean
  modelList: Model[]
  selectedModel: SkillBuilderModel | undefined
  onSelect: (model: SkillBuilderModel) => void
}) {
  return (
    <div className="max-w-full min-w-0">
      {isLoading ? (
        <div className="h-6 w-20 rounded-md bg-state-base-hover" />
      ) : (
        <ModelParameterModal
          isAdvancedMode
          modelId={selectedModel?.model ?? ''}
          provider={selectedModel?.provider ?? ''}
          completionParams={(selectedModel?.model_settings ?? {}) as FormValue}
          hideDebugWithMultipleModel
          modelList={modelList}
          popupClassName="w-[400px]"
          triggerContainerClassName="max-w-full min-w-0"
          setModel={({ modelId, provider }) => {
            onSelect({
              ...selectedModel,
              provider,
              model: modelId,
            })
          }}
          onCompletionParamsChange={(modelSettings) => {
            if (!selectedModel) return

            onSelect({
              ...selectedModel,
              model_settings: modelSettings,
            })
          }}
        />
      )}
    </div>
  )
}

function SkillBuilderPanel({ onClose, skillId }: { onClose: () => void; skillId: string }) {
  const { t } = useTranslation('agentV2')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<BuilderChatMessage[]>([])
  const [attachments, setAttachments] = useState<SkillBuilderAttachment[]>([])
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const assistAbortControllerRef = useRef<AbortController | null>(null)
  const { data: defaultTextGenerationModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: textGenerationModelList, isLoading: isTextGenerationModelListLoading } =
    useModelList(ModelTypeEnum.textGeneration)
  const fallbackModel = useMemo<SkillBuilderModel | undefined>(() => {
    for (const provider of textGenerationModelList) {
      if (provider.status !== ModelStatusEnum.active) continue

      const model = provider.models.find((model) => model.status === ModelStatusEnum.active)
      if (model) {
        return {
          provider: provider.provider,
          model: model.model,
        }
      }
    }

    return undefined
  }, [textGenerationModelList])
  const defaultBuilderModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const [selectedModel, setSelectedModel] = useState<SkillBuilderModel | undefined>()
  const activeSelectedModel = selectedModel ?? defaultBuilderModel ?? fallbackModel
  const canSendBuilderMessage = !!activeSelectedModel?.provider && !!activeSelectedModel?.model
  const suggestions = [
    t(($) => $['skillManagement.detail.builder.exampleIssueTriage']),
    t(($) => $['skillManagement.detail.builder.exampleSalesFollowUp']),
    t(($) => $['skillManagement.detail.builder.exampleOnboarding']),
  ]
  const followUpSuggestions = [
    t(($) => $['skillManagement.detail.builder.followUpNameIcon']),
    t(($) => $['skillManagement.detail.builder.followUpDisplayName']),
    t(($) => $['skillManagement.detail.builder.exampleIssueTriage']),
  ]
  const inputPlaceholder =
    messages.length > 0
      ? t(($) => $['skillManagement.detail.builder.modifyPlaceholder'])
      : t(($) => $['skillManagement.detail.builder.placeholder'])

  useEffect(() => {
    return () => {
      assistAbortControllerRef.current?.abort()
    }
  }, [])

  const handleRestart = () => {
    assistAbortControllerRef.current?.abort()
    assistAbortControllerRef.current = null
    setPrompt('')
    setMessages([])
    setAttachments([])
    setIsUploadingAttachment(false)
    setIsSending(false)
    isSendingRef.current = false
  }

  const handleClose = () => {
    assistAbortControllerRef.current?.abort()
    assistAbortControllerRef.current = null
    isSendingRef.current = false
    setIsSending(false)
    onClose()
  }

  const handleAttachmentChange = async (file: File | undefined) => {
    if (!file || isUploadingAttachment) return
    if (!isAllowedSkillBuilderAttachment(file)) {
      toast.error(t(($) => $['skillManagement.detail.builder.attachUnsupported']))
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      return
    }

    setIsUploadingAttachment(true)
    try {
      const uploadedFile = await uploadSkillFile(file)

      setAttachments((currentAttachments) => [
        ...currentAttachments,
        {
          id: uploadedFile.id,
          mimeType: uploadedFile.mime_type || file.type || 'application/octet-stream',
          name: uploadedFile.name || file.name,
          size: uploadedFile.size ?? file.size,
          toolFileId: uploadedFile.id,
        },
      ])
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['skillManagement.detail.builder.attachFailed']),
      )
    } finally {
      setIsUploadingAttachment(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  const removeAttachment = (attachmentId: string) => {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    )
  }

  const handleSend = (messageText = prompt) => {
    const trimmedPrompt = messageText.trim()
    const attachedFiles = attachments
    if (
      !canSendBuilderMessage ||
      (!trimmedPrompt && attachedFiles.length === 0) ||
      isSendingRef.current
    )
      return
    isSendingRef.current = true
    const requestMessage =
      trimmedPrompt || t(($) => $['skillManagement.detail.builder.attachmentOnlyMessage'])

    const userMessage: BuilderChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: requestMessage,
    }
    const assistantMessageId = `assistant-${Date.now()}`
    const assistantMessage: BuilderChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    }

    setMessages((currentMessages) => [...currentMessages, userMessage, assistantMessage])
    setPrompt('')
    setAttachments([])
    setIsSending(true)

    void sendSkillAssistMessage({
      skillId,
      attachments: attachedFiles.map((attachment) => ({
        mime_type: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
        tool_file_id: attachment.toolFileId,
      })),
      message: requestMessage,
      model: activeSelectedModel,
      getAbortController: (abortController) => {
        assistAbortControllerRef.current = abortController
      },
      onData: (chunk) => {
        if (!chunk) return

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${chunk}` }
              : message,
          ),
        )
      },
      onCompleted: (hasError, errorMessage) => {
        setIsSending(false)
        isSendingRef.current = false
        assistAbortControllerRef.current = null
        if (hasError && errorMessage) toast.error(errorMessage)
      },
      onError: (errorMessage) => {
        setIsSending(false)
        isSendingRef.current = false
        assistAbortControllerRef.current = null
        if (errorMessage) toast.error(errorMessage)
      },
    }).catch((error: unknown) => {
      setIsSending(false)
      isSendingRef.current = false
      assistAbortControllerRef.current = null
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['skillManagement.detail.builder.sendFailed']),
      )
    })
  }

  return (
    <aside className="relative flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-divider-subtle bg-background-section">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.32]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgb(99 102 241 / 0.18) 1px, transparent 0)',
          backgroundSize: '12px 12px',
        }}
      />
      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-2 px-4">
        <h2 className="system-xs-semibold-uppercase text-text-secondary">
          {t(($) => $['skillManagement.detail.builder.title'])}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.builder.restart'])}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={handleRestart}
          >
            <span aria-hidden className="i-ri-restart-line size-4" />
          </button>
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.builder.close'])}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={handleClose}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-6">
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {messages.length > 0 ? (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'max-w-[94%] overflow-x-auto rounded-xl px-3 py-2 shadow-xs',
                    message.role === 'user'
                      ? 'ml-auto bg-state-accent-hover text-text-secondary'
                      : 'mr-auto bg-background-default text-text-secondary',
                  )}
                >
                  {message.content ? (
                    <Markdown content={message.content} className="text-[13px]! leading-5!" />
                  ) : (
                    <span className="system-xs-regular text-text-tertiary">
                      {t(($) => $['agentDetail.configure.answer.thinking'])}
                    </span>
                  )}
                </div>
              ))}
              <div className="flex flex-col items-end gap-2 pt-2">
                {followUpSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="max-w-full cursor-pointer rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-right system-xs-medium text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSending || !canSendBuilderMessage}
                    onClick={() => handleSend(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-full flex-col justify-end">
              <div className="mb-5 flex flex-col items-center text-center">
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-state-accent-hover bg-state-accent-hover text-text-accent shadow-xs">
                  <span aria-hidden className="i-ri-box-3-line size-5" />
                </div>
                <h3 className="system-sm-semibold text-text-secondary">
                  {t(($) => $['skillManagement.detail.builder.promptTitle'])}
                </h3>
                <p className="mt-1 max-w-56 system-xs-regular text-text-tertiary">
                  {t(($) => $['skillManagement.detail.builder.promptDescription'])}
                </p>
              </div>
              <div className="mb-4 space-y-2">
                <p className="system-2xs-semibold-uppercase text-text-quaternary">
                  {t(($) => $['skillManagement.detail.builder.tryExample'])}
                </p>
                <div className="flex flex-col items-end gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="max-w-full cursor-pointer rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-right system-xs-medium text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSending || !canSendBuilderMessage}
                      onClick={() => handleSend(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 rounded-xl border border-divider-subtle bg-background-default px-3 py-2 shadow-lg">
          <input
            ref={attachmentInputRef}
            type="file"
            accept={skillBuilderAttachmentAccept}
            className="hidden"
            onChange={(event) => {
              void handleAttachmentChange(event.currentTarget.files?.[0])
            }}
          />
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex max-w-full min-w-0 items-center gap-1 rounded-md border border-divider-subtle bg-background-section px-2 py-1 system-xs-regular text-text-secondary"
                >
                  <span
                    aria-hidden
                    className="i-ri-attachment-2 size-3.5 shrink-0 text-text-tertiary"
                  />
                  <span className="min-w-0 truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={t(($) => $['skillManagement.detail.builder.removeAttachment'], {
                      name: attachment.name,
                    })}
                    className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    disabled={isSending}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <span aria-hidden className="i-ri-close-line size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={prompt}
            rows={2}
            className="h-10 w-full resize-none bg-transparent system-sm-regular text-text-secondary outline-hidden placeholder:text-text-quaternary"
            placeholder={inputPlaceholder}
            disabled={isSending}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return

              event.preventDefault()
              handleSend()
            }}
          />
          <div className="mt-1 flex h-7 min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <BuilderModelSelector
                isLoading={isTextGenerationModelListLoading}
                modelList={textGenerationModelList}
                selectedModel={activeSelectedModel}
                onSelect={setSelectedModel}
              />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-divider-subtle pl-1">
              <button
                type="button"
                aria-label={t(($) => $['skillManagement.detail.builder.attach'])}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSending || isUploadingAttachment}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <span
                  aria-hidden
                  className={cn(
                    isUploadingAttachment ? 'i-ri-loader-4-line animate-spin' : 'i-ri-attachment-2',
                    'size-4',
                  )}
                />
              </button>
              <Tooltip>
                <TooltipTrigger
                  className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  aria-label={t(($) => $['skillManagement.detail.builder.voice'])}
                  onClick={() => {
                    toast.info(t(($) => $['skillManagement.detail.builder.voiceUnavailable']))
                  }}
                >
                  <span aria-hidden className="i-ri-mic-line size-4" />
                </TooltipTrigger>
                <TooltipContent placement="top">
                  {t(($) => $['skillManagement.detail.builder.voiceUnavailable'])}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                aria-label={t(($) => $['skillManagement.detail.builder.send'])}
                className="hover:bg-state-accent-solid-hover flex size-7 cursor-pointer items-center justify-center rounded-lg bg-state-accent-solid text-text-primary-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !canSendBuilderMessage ||
                  (!prompt.trim() && attachments.length === 0) ||
                  isSending ||
                  isUploadingAttachment
                }
                onClick={() => handleSend()}
              >
                <span
                  aria-hidden
                  className={cn(
                    isSending ? 'i-ri-loader-4-line animate-spin' : 'i-ri-arrow-up-line',
                    'size-4',
                  )}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function SkillDetailRightPanelRail({
  onOpenBuilder,
  onOpenVersions,
}: {
  onOpenBuilder: () => void
  onOpenVersions: () => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-l border-divider-subtle bg-background-section py-3">
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.builder.open'])}
        className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={onOpenBuilder}
      >
        <span aria-hidden className="i-ri-box-3-line size-4" />
      </button>
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.versionHistory'])}
        className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={onOpenVersions}
      >
        <span aria-hidden className="i-ri-history-line size-4" />
      </button>
    </aside>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-divider-subtle px-6">
        <SkeletonRectangle className="my-0 size-10 rounded-[10px] opacity-20" />
        <div className="flex flex-col gap-2">
          <SkeletonRectangle className="my-0 h-3 w-40 rounded-md opacity-20" />
          <SkeletonRectangle className="my-0 h-2 w-28 rounded-md opacity-12" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <SkeletonRectangle className="my-0 h-full w-64 rounded-none opacity-10" />
        <SkeletonRectangle className="my-4 ml-4 h-[calc(100%-2rem)] flex-1 rounded-lg opacity-10" />
        <SkeletonRectangle className="my-0 h-full w-[420px] rounded-none opacity-10" />
      </div>
    </div>
  )
}

export default function SkillDetailPage() {
  const { t } = useTranslation('agentV2')
  const params = useParams<{ skillId: string }>()
  const skillId = params.skillId
  const queryClient = useQueryClient()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([])
  const [rightPanelMode, setRightPanelMode] = useState<'builder' | 'hidden' | 'versions'>('builder')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const skillDetailQueryOptions = consoleQuery.workspaces.current.skills.bySkillId.get.queryOptions(
    {
      input: {
        params: {
          skill_id: skillId,
        },
      },
    },
  )
  const skillDetailQueryKey = consoleQuery.workspaces.current.skills.bySkillId.get.key({
    type: 'query',
    input: {
      params: {
        skill_id: skillId,
      },
    },
  })
  const detailQuery = useQuery(skillDetailQueryOptions)
  const versionsQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.versions.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  )
  const versions = versionsQuery.data?.data ?? []
  const defaultVersionId =
    rightPanelMode === 'versions'
      ? (versions.find((version) => version.is_latest)?.id ?? versions[0]?.id ?? null)
      : null
  const activeVersionId = selectedVersionId ?? defaultVersionId
  const versionDetailQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
          version_id: activeVersionId ?? '',
        },
      },
    }),
    enabled: !!activeVersionId,
  })
  const publishMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.publish.post.mutationOptions(),
  )
  const restoreMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.restore.post.mutationOptions(),
  )
  const detail = detailQuery.data
  const draftFiles = detail?.files ?? []
  const readonlyFiles = versionDetailQuery.data?.files ?? []
  const activeFiles = activeVersionId ? readonlyFiles : draftFiles
  const fallbackFile = getFirstTextFile(activeFiles)
  const activeSelectedPath =
    selectedPath && findFileByPath(activeFiles, selectedPath) ? selectedPath : fallbackFile?.path
  const selectedFile = findFileByPath(activeFiles, activeSelectedPath)
  const openFiles = activeFiles.filter(
    (file) =>
      !isDirectory(file) &&
      (openFilePaths.includes(file.path) ||
        (!!activeSelectedPath && file.path === activeSelectedPath)),
  )
  const selectedVersion = versions.find((version) => version.id === activeVersionId)

  useDocumentTitle(detail?.display_name ?? t(($) => $['skillManagement.title']))

  const handleOpenFile = (path: string) => {
    const targetFile = findFileByPath(activeFiles, path)
    if (!targetFile || isDirectory(targetFile)) return

    setSelectedPath(path)
    setOpenFilePaths((currentPaths) =>
      currentPaths.includes(path) ? currentPaths : [...currentPaths, path],
    )
  }

  const handleCloseFile = (path: string) => {
    const nextPaths = openFilePaths.filter((currentPath) => currentPath !== path)
    setOpenFilePaths(nextPaths)

    if (path === activeSelectedPath) {
      const nextSelectedPath = nextPaths.at(-1) ?? getFirstTextFile(activeFiles)?.path
      setSelectedPath(nextSelectedPath)
    }
  }

  const handlePublish = () => {
    if (publishMutation.isPending) return

    publishMutation.mutate(
      {
        params: {
          skill_id: skillId,
        },
        body: {},
      },
      {
        onSuccess: async () => {
          toast.success(t(($) => $['skillManagement.detail.publishSuccess']))
          const detailQueryKey = consoleQuery.workspaces.current.skills.bySkillId.get.key({
            type: 'query',
            input: {
              params: {
                skill_id: skillId,
              },
            },
          })
          await queryClient.invalidateQueries({ queryKey: detailQueryKey })
          await queryClient.refetchQueries({ queryKey: detailQueryKey, type: 'active' })
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
            queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
          })
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.detail.publishFailed']))
        },
      },
    )
  }
  const handleRestoreSelectedVersion = async () => {
    if (!selectedVersion || restoreMutation.isPending) return

    try {
      await restoreMutation.mutateAsync({
        params: {
          skill_id: skillId,
        },
        body: {
          version_id: selectedVersion.id,
          version_name: selectedVersion.version_name,
        },
      })
      await queryClient.invalidateQueries({ queryKey: skillDetailQueryKey })
      await queryClient.refetchQueries({ queryKey: skillDetailQueryKey, type: 'active' })
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
        queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
      })
      toast.success(t(($) => $['skillManagement.detail.restoreVersionSuccess']))
      setSelectedVersionId(null)
      setRightPanelMode('builder')
      setSelectedPath(undefined)
      setOpenFilePaths([])
    } catch {
      toast.error(t(($) => $['skillManagement.detail.restoreVersionFailed']))
    }
  }

  const handleExitVersion = () => {
    setSelectedVersionId(null)
    setRightPanelMode('builder')
    setSelectedPath(undefined)
    setOpenFilePaths([])
  }

  const handleOpenVersions = () => {
    setRightPanelMode('versions')
    setSelectedPath(undefined)
    setOpenFilePaths([])
  }

  if (detailQuery.isPending) return <DetailSkeleton />

  if (detailQuery.isError || !detail) {
    return (
      <div className="flex h-0 min-w-0 grow items-center justify-center bg-background-body p-6">
        <div className="flex flex-col items-center gap-3">
          <span aria-hidden className="i-ri-error-warning-line size-8 text-text-quaternary" />
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['skillManagement.detail.loadFailed'])}
          </p>
          <Link
            href="/skills"
            className="rounded-md system-sm-medium text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $['skillManagement.detail.back'])}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-0 min-w-0 grow overflow-hidden bg-background-default">
      <div className="flex min-h-0 min-w-0 flex-1">
        <FileTree
          collapsed={sidebarCollapsed}
          detail={detail}
          files={activeFiles}
          onCollapsedChange={setSidebarCollapsed}
          onSelect={handleOpenFile}
          readonly={!!activeVersionId}
          selectedPath={activeSelectedPath}
          skillId={skillId}
        />
        <FileEditor
          key={`${activeVersionId ?? 'draft'}:${activeSelectedPath ?? 'empty'}`}
          detail={detail}
          file={selectedFile}
          onCloseFile={handleCloseFile}
          onOpenVersions={handleOpenVersions}
          onPublish={handlePublish}
          onRestoreVersion={handleRestoreSelectedVersion}
          onExitVersion={handleExitVersion}
          onSelectFile={handleOpenFile}
          openFiles={openFiles}
          publishing={activeVersionId ? restoreMutation.isPending : publishMutation.isPending}
          readonly={!!activeVersionId}
          selectedPath={activeSelectedPath}
          selectedVersion={selectedVersion}
          selectedVersionId={activeVersionId}
          skillId={skillId}
        />
        {rightPanelMode === 'builder' && (
          <SkillBuilderPanel skillId={skillId} onClose={() => setRightPanelMode('hidden')} />
        )}
        {rightPanelMode === 'hidden' && (
          <SkillDetailRightPanelRail
            onOpenBuilder={() => setRightPanelMode('builder')}
            onOpenVersions={handleOpenVersions}
          />
        )}
        {rightPanelMode === 'versions' && (
          <VersionPanel
            skillId={skillId}
            versions={versions}
            selectedVersionId={activeVersionId}
            onClose={handleExitVersion}
            onSelect={(versionId) => {
              setSelectedVersionId(versionId)
              setSelectedPath(undefined)
              setOpenFilePaths([])
            }}
          />
        )}
      </div>
    </div>
  )
}
