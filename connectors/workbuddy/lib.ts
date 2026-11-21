export type FieldValue = string | readonly string[]
export type SkillMeta = { skill: string; fields: Record<string, FieldValue> }

export const CONNECTOR_TYPES = ['cli', 'mcp'] as const
export type ConnectorType = (typeof CONNECTOR_TYPES)[number]
export const TOKEN_AUTH_MODE = 'token'
export const TOKEN_SCHEMA_FILE = 'token-schema.json'
export const MCP_CONNECTOR_TYPE = 'mcp' satisfies ConnectorType
const DEFAULT_CONNECTOR_TYPE: ConnectorType = MCP_CONNECTOR_TYPE

export type ConnectorMeta = { version: string; type: ConnectorType; auth_mode?: string }

const CONNECTOR_FILES: Record<ConnectorType, readonly string[]> = {
  cli: ['cli.json'],
  mcp: ['mcp.json'],
}

export const REQUIRED_SKILL_FIELDS = [
  'display_name',
  'display_name_en',
  'description_zh',
  'description_en',
  'author',
] as const
const OWNED_SKILL_FIELDS = ['version', 'name', 'description'] as const

const STABLE_TAG = /^(\d+)\.(\d+)\.(\d+)$/
const FRONTMATTER_FENCE = '---'
const KEY_LINE = /^([A-Z_][\w-]*):/i

export function latestStableTag(tags: readonly string[]): string {
  const stable = tags
    .map((tag) => ({ tag, parts: STABLE_TAG.exec(tag)?.slice(1).map(Number) }))
    .filter((entry): entry is { tag: string; parts: number[] } => entry.parts !== undefined)
  if (stable.length === 0)
    throw new Error('no stable release tag (x.y.z) found; run git fetch --tags')
  const compare = (a: number[], b: number[]) => a.reduce((diff, part, i) => diff || part - b[i]!, 0)
  return stable.reduce((best, entry) => (compare(entry.parts, best.parts) > 0 ? entry : best)).tag
}

export function skillFields(meta: SkillMeta, version: string): Record<string, FieldValue> {
  for (const key of OWNED_SKILL_FIELDS) {
    if (key in meta.fields)
      throw new Error(`skill-meta must not set "${key}"; it is owned by the packaging script`)
  }
  for (const key of REQUIRED_SKILL_FIELDS) {
    if (!(key in meta.fields)) throw new Error(`skill-meta is missing required field "${key}"`)
  }
  return { ...meta.fields, version }
}

function frontmatterCloseIndex(lines: readonly string[]): number {
  const closeIndex = lines.indexOf(FRONTMATTER_FENCE, 1)
  if (lines[0] !== FRONTMATTER_FENCE || closeIndex === -1)
    throw new Error('SKILL.md has no frontmatter')
  return closeIndex
}

export function insertAfterFrontmatter(skillMd: string, text: string): string {
  const lines = skillMd.split('\n')
  lines.splice(frontmatterCloseIndex(lines) + 1, 0, '', text.trimEnd())
  return lines.join('\n')
}

export function insertFrontmatter(skillMd: string, fields: Record<string, FieldValue>): string {
  const lines = skillMd.split('\n')
  const closeIndex = frontmatterCloseIndex(lines)

  const existing = new Set(lines.slice(1, closeIndex).map((line) => KEY_LINE.exec(line)?.[1]))
  const added: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (existing.has(key)) throw new Error(`SKILL.md frontmatter already defines "${key}"`)
    if (typeof value === 'string') {
      added.push(`${key}: ${JSON.stringify(value)}`)
      continue
    }
    added.push(`${key}:`, ...value.map((item) => `  - ${JSON.stringify(item)}`))
  }
  lines.splice(closeIndex, 0, ...added)
  return lines.join('\n')
}

function isConnectorType(value: unknown): value is ConnectorType {
  return CONNECTOR_TYPES.some((type) => type === value)
}

// A missing "type" means "mcp", as WorkBuddy reads it.
export function connectorMeta(raw: Record<string, unknown>, path: string): ConnectorMeta {
  const { version, auth_mode: authMode } = raw
  if (typeof version !== 'string' || !version)
    throw new Error(`${path}: "version" must be a non-empty string`)
  const type = raw.type ?? DEFAULT_CONNECTOR_TYPE
  if (!isConnectorType(type))
    throw new Error(`${path}: "type" must be one of ${CONNECTOR_TYPES.join(', ')}`)
  return { version, type, ...(typeof authMode === 'string' && { auth_mode: authMode }) }
}

// The files beside connector-meta.json that a connector of this kind ships.
export function connectorFiles(meta: ConnectorMeta): readonly string[] {
  const files = CONNECTOR_FILES[meta.type]
  if (meta.type !== MCP_CONNECTOR_TYPE) return files
  if (meta.auth_mode !== TOKEN_AUTH_MODE) return files
  return [...files, TOKEN_SCHEMA_FILE]
}
