type MarkdownMetadataEntry = {
  key: string
  value: string
}

export type ParsedMarkdownContent = {
  body: string
  description: string
  displayName: string
  metadata: MarkdownMetadataEntry[]
  name: string
}

export const defaultSkillDescription =
  'Describe what this Skill does and when an Agent should use it.'

export const defaultSkillBody =
  '# Untitled skill\n\nDescribe what this Skill does, when an Agent should use it, and any step-by-step instructions it must follow.'

export const untitledSkillDisplayName = 'Untitled skill'

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
