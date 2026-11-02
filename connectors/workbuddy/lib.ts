export type FieldValue = string | readonly string[]
export type SkillMeta = { skill: string; fields: Record<string, FieldValue> }

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

export function insertFrontmatter(skillMd: string, fields: Record<string, FieldValue>): string {
  const lines = skillMd.split('\n')
  const closeIndex = lines.indexOf(FRONTMATTER_FENCE, 1)
  if (lines[0] !== FRONTMATTER_FENCE || closeIndex === -1)
    throw new Error('SKILL.md has no frontmatter')

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
