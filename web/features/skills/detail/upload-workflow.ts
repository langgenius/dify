import type {
  SkillFileCheckItemResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { getPathBaseName, getPathDirName, joinSkillPath } from './shared'

export type SkillUploadDecision = 'keep-both' | 'replace' | 'skip' | 'use-suggestion'

type SkillUploadReviewKind = 'conflict' | 'invalid-name' | 'ready' | 'skipped'

export type SkillUploadReviewItem = {
  check: SkillFileCheckItemResponse
  decision?: SkillUploadDecision
  file: File
  id: string
  kind: SkillUploadReviewKind
  originalPath: string
  resolvedPath?: string
  suggestedPath?: string
}

const conflictCodes = new Set(['duplicate_file_path', 'file_already_exists'])

function splitFileName(fileName: string) {
  const extensionIndex = fileName.lastIndexOf('.')
  if (extensionIndex <= 0) return { extension: '', stem: fileName }
  return {
    extension: fileName.slice(extensionIndex),
    stem: fileName.slice(0, extensionIndex),
  }
}

export function createAvailableUploadPath(path: string, unavailablePaths: Iterable<string>) {
  const unavailable = new Set(unavailablePaths)
  const directory = getPathDirName(path)
  const { extension, stem } = splitFileName(getPathBaseName(path))

  for (let index = 2; index < 1000; index += 1) {
    const candidate = joinSkillPath(directory, `${stem}-${index}${extension}`)
    if (!unavailable.has(candidate)) return candidate
  }

  return undefined
}

export function createSuggestedUploadPath(path: string, unavailablePaths: Iterable<string>) {
  const directory = getPathDirName(path)
  const { extension, stem } = splitFileName(getPathBaseName(path))
  const normalizedStem =
    stem
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'file'
  const directPath = joinSkillPath(directory, `${normalizedStem}${extension.toLowerCase()}`)
  const unavailable = new Set(unavailablePaths)
  return unavailable.has(directPath)
    ? createAvailableUploadPath(directPath, unavailable)
    : directPath
}

export function buildUploadReviewItems({
  checks,
  existingFiles,
  files,
  itemIds,
  paths,
}: {
  checks: Record<string, SkillFileCheckItemResponse>
  existingFiles: SkillFileResponse[]
  files: File[]
  itemIds: string[]
  paths: string[]
}) {
  const unavailablePaths = new Set(existingFiles.map((file) => file.path))

  return files.map((file, index): SkillUploadReviewItem => {
    const originalPath = paths[index] ?? file.name
    const check = checks[file.name] ?? {
      errors: [],
      extension: '',
      filename: file.name,
      mime_type: file.type,
      path: originalPath,
      size: file.size,
    }
    const errorCodes = new Set((check.errors ?? []).map((error) => error.code))
    const base = {
      check,
      file,
      id: itemIds[index] ?? `${file.name}-${index}`,
      originalPath,
    }

    if (errorCodes.size === 0) {
      unavailablePaths.add(check.path)
      return { ...base, kind: 'ready', resolvedPath: check.path }
    }

    if ([...errorCodes].some((code) => conflictCodes.has(code))) {
      const suggestedPath = createAvailableUploadPath(check.path, unavailablePaths)
      if (suggestedPath) unavailablePaths.add(suggestedPath)
      return { ...base, kind: 'conflict', suggestedPath }
    }

    if (errorCodes.has('invalid_filename')) {
      const suggestedPath = createSuggestedUploadPath(check.path || originalPath, unavailablePaths)
      if (suggestedPath) unavailablePaths.add(suggestedPath)
      return { ...base, kind: 'invalid-name', suggestedPath }
    }

    return { ...base, decision: 'skip', kind: 'skipped' }
  })
}

export function resolveUploadReviewItem(
  item: SkillUploadReviewItem,
  decision: SkillUploadDecision,
): SkillUploadReviewItem {
  if (decision === 'skip') return { ...item, decision, resolvedPath: undefined }
  if (decision === 'keep-both' || decision === 'use-suggestion')
    return { ...item, decision, resolvedPath: item.suggestedPath }
  return { ...item, decision, resolvedPath: item.check.path }
}

export function isUploadReviewResolved(item: SkillUploadReviewItem) {
  return item.kind === 'ready' || item.kind === 'skipped' || item.decision !== undefined
}

export function isUploadReviewItemSkipped(item: SkillUploadReviewItem) {
  return item.kind === 'skipped' || item.decision === 'skip'
}
