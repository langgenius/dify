import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'

type RosterReferenceKind = 'skill' | 'file' | 'tool-all' | 'tool' | 'cli_tool' | 'knowledge'

export type RosterReferenceToken = {
  kind: RosterReferenceKind
  id: string
  label: string
}

export const ROSTER_REFERENCE_REGEX = /\[§(?:skill|file|tool-all|tool|cli_tool|knowledge):[^\]§\n\r]+§\]/

const KNOWN_KINDS = new Set<RosterReferenceKind>([
  'skill',
  'file',
  'tool-all',
  'tool',
  'cli_tool',
  'knowledge',
])

export function parseRosterReferenceToken(text: string): RosterReferenceToken | null {
  if (!text.startsWith('[§') || !text.endsWith('§]'))
    return null

  const body = text.slice(2, -2)
  const firstColonIndex = body.indexOf(':')
  if (firstColonIndex === -1)
    return null

  const kind = body.slice(0, firstColonIndex) as RosterReferenceKind
  if (!KNOWN_KINDS.has(kind))
    return null

  const rest = body.slice(firstColonIndex + 1)
  const secondColonIndex = rest.indexOf(':')
  const id = secondColonIndex === -1 ? rest : rest.slice(0, secondColonIndex)
  const label = secondColonIndex === -1 ? id : rest.slice(secondColonIndex + 1)

  if (!id || !label)
    return null

  return {
    kind,
    id,
    label,
  }
}

const codeFileExtensions = new Set([
  'css',
  'go',
  'html',
  'htm',
  'js',
  'jsx',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'ts',
  'tsx',
  'vue',
  'yaml',
  'yml',
])
const imageFileExtensions = new Set(['apng', 'avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const tableFileExtensions = new Set(['csv', 'xls', 'xlsx'])
const archiveFileExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip'])

export function getRosterReferenceFileIconType(label: string): FileTreeIconType {
  const extension = label.includes('.') ? label.split('.').pop()?.toLowerCase() : undefined

  if (!extension)
    return 'folder'
  if (imageFileExtensions.has(extension))
    return 'image'
  if (extension === 'pdf')
    return 'pdf'
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx')
    return 'markdown'
  if (extension === 'json')
    return 'json'
  if (tableFileExtensions.has(extension))
    return 'table'
  if (archiveFileExtensions.has(extension))
    return 'archive'
  if (codeFileExtensions.has(extension))
    return 'code'
  if (extension === 'txt')
    return 'text'

  return 'file'
}

export function getRosterReferenceIconClassName(token: RosterReferenceToken) {
  switch (token.kind) {
    case 'skill':
      return 'i-custom-public-agent-building-blocks text-text-tertiary'
    case 'file':
      return ''
    case 'tool-all':
    case 'tool':
      return 'i-custom-public-other-default-tool-icon text-[#ef5b39]'
    case 'cli_tool':
      return 'i-ri-terminal-box-line text-text-primary-on-surface'
    case 'knowledge':
      return 'i-ri-book-open-line'
  }
}
