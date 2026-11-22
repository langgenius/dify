import type { SkillFileResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { getSkillFileIconClass, isDirectory } from '../files/file-format'
import { getPathBaseName } from '../files/tree-model'

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

export function parseMarkdownBodyReferences(body: string): MarkdownBodySegment[] {
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
