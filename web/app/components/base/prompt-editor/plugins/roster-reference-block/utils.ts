export type RosterReferenceKind = 'skill' | 'file' | 'tool-all' | 'tool' | 'cli_tool' | 'knowledge'

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

const getFileTypeIconClassName = (label: string) => {
  const extension = label.includes('.') ? label.split('.').pop()?.toLowerCase() : undefined

  switch (extension) {
    case 'csv':
      return 'i-ri-file-excel-2-line text-util-colors-green-green-600'
    case 'doc':
    case 'docx':
      return 'i-ri-file-word-2-line text-util-colors-blue-blue-600'
    case 'htm':
    case 'html':
    case 'json':
      return 'i-ri-file-code-line text-util-colors-purple-purple-600'
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'i-ri-markdown-line text-text-tertiary'
    case 'pdf':
      return 'i-ri-file-pdf-2-line text-util-colors-red-red-600'
    case 'txt':
      return 'i-ri-file-text-line text-text-tertiary'
    case 'xls':
    case 'xlsx':
      return 'i-ri-file-excel-2-line text-util-colors-green-green-600'
    default:
      return extension ? 'i-ri-file-line text-text-tertiary' : 'i-ri-folder-2-line text-text-tertiary'
  }
}

export function getRosterReferenceIconClassName(token: RosterReferenceToken) {
  switch (token.kind) {
    case 'skill':
      return 'i-custom-public-agent-building-blocks text-text-tertiary'
    case 'file':
      return getFileTypeIconClassName(token.label)
    case 'tool-all':
    case 'tool':
      return 'i-custom-public-other-default-tool-icon text-[#ef5b39]'
    case 'cli_tool':
      return 'i-ri-terminal-box-line text-text-primary-on-surface'
    case 'knowledge':
      return 'i-ri-book-open-line'
  }
}
