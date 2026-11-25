import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type FieldValue = string | readonly string[]
type SkillMeta = { skill: string; fields: Record<string, FieldValue> }
type ConnectorMeta = { version: string; auth_mode?: string }

const WORKBUDDY_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(WORKBUDDY_DIR, '..', '..')
const BUILD_NAME = 'build'
const CONNECTOR_NAME = /^[a-z0-9][a-z0-9-]*$/
const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024
const BUILD_DIR = join(WORKBUDDY_DIR, BUILD_NAME)
const ICON_FILE = 'icon.png'
const META_FILE = 'connector-meta.json'
const USAGE = 'usage: node package.ts <connector> [--tag <tag> | --worktree]'
const WORKTREE_LABEL = 'worktree'
const SKILL_INTRO_FILE = 'skill-intro.md'
const SKILLS_DIR = 'skills'
const SKILL_FILE = 'SKILL.md'
const SKILL_META_FILE = 'skill-meta.json'
const WORKBUDDY_MAX_PACKAGE_BYTES = 20 * 1024 * 1024
const BYTES_PER_MIB = 1024 * 1024
const HIDDEN_SEGMENT_PREFIX = '.'
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const ABSOLUTE_OR_ANCHOR = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i
const MCP_CONNECTOR_TYPE = 'mcp'
const MCP_FILE = 'mcp.json'
const TOKEN_AUTH_MODE = 'token'
const TOKEN_SCHEMA_FILE = 'token-schema.json'
const OWNED_SKILL_FIELD = 'version'
const REQUIRED_SKILL_FIELDS = [
  'display_name',
  'display_name_en',
  'description_zh',
  'description_en',
  'author',
] as const
const STABLE_TAG = /^(\d+)\.(\d+)\.(\d+)$/
const FRONTMATTER_FENCE = '---'
const KEY_LINE = /^([A-Z_][\w-]*):/i

function latestStableTag(tags: readonly string[]): string {
  const stable = tags
    .map((tag) => ({ tag, parts: STABLE_TAG.exec(tag)?.slice(1).map(Number) }))
    .filter((entry): entry is { tag: string; parts: number[] } => entry.parts !== undefined)
  if (stable.length === 0)
    throw new Error('no stable release tag (x.y.z) found; run git fetch --tags')
  const compare = (a: number[], b: number[]) => a.reduce((diff, part, i) => diff || part - b[i]!, 0)
  return stable.reduce((best, entry) => (compare(entry.parts, best.parts) > 0 ? entry : best)).tag
}

// "name" and "description" are refused by insertFrontmatter: SKILL.md already defines them.
function skillFields(meta: SkillMeta, version: string): Record<string, FieldValue> {
  if (OWNED_SKILL_FIELD in meta.fields)
    throw new Error(
      `skill-meta must not set "${OWNED_SKILL_FIELD}"; it is owned by the packaging script`,
    )
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

function insertAfterFrontmatter(skillMd: string, text: string): string {
  const lines = skillMd.split('\n')
  lines.splice(frontmatterCloseIndex(lines) + 1, 0, '', text.trimEnd())
  return lines.join('\n')
}

function insertFrontmatter(skillMd: string, fields: Record<string, FieldValue>): string {
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

// A missing "type" means "mcp", as WorkBuddy reads it.
function connectorMeta(raw: Record<string, unknown>, path: string): ConnectorMeta {
  const { version, auth_mode: authMode } = raw
  if (typeof version !== 'string' || !version)
    throw new Error(`${path}: "version" must be a non-empty string`)
  if ((raw.type ?? MCP_CONNECTOR_TYPE) !== MCP_CONNECTOR_TYPE)
    throw new Error(`${path}: "type" must be ${MCP_CONNECTOR_TYPE}`)
  return { version, ...(typeof authMode === 'string' && { auth_mode: authMode }) }
}

// The files beside connector-meta.json that the connector ships.
function connectorFiles(meta: ConnectorMeta): readonly string[] {
  const files = [MCP_FILE, ICON_FILE]
  if (meta.auth_mode !== TOKEN_AUTH_MODE) return files
  return [...files, TOKEN_SCHEMA_FILE]
}

function run(command: string, args: string[], cwd = REPO_ROOT): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function resolveTag(tag: string | undefined): string {
  const resolved = tag ?? latestStableTag(run('git', ['tag', '--list']).split('\n').filter(Boolean))
  try {
    run('git', ['rev-parse', '--verify', `${resolved}^{commit}`])
  } catch {
    throw new Error(`tag "${resolved}" not found; run git fetch --tags`)
  }
  return resolved
}

function isVisiblePath(root: string): (source: string) => boolean {
  return (source) =>
    !relative(root, source)
      .split(sep)
      .some((segment) => segment.startsWith(HIDDEN_SEGMENT_PREFIX))
}

function relativeLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(MARKDOWN_LINK)]
    .map((match) => match[1]!)
    .filter((target) => !ABSOLUTE_OR_ANCHOR.test(target))
    .map((target) => target.split('#')[0]!)
    .filter(Boolean)
}

function assertIntroLinksExist(intro: string, skillDir: string, source: string) {
  const missing = relativeLinkTargets(intro).filter((target) => !existsSync(join(skillDir, target)))
  if (missing.length > 0)
    throw new Error(
      `${SKILL_INTRO_FILE} links to ${missing.join(', ')}, which ${source} does not contain in ${SKILLS_DIR}/; build from a newer tag or use --worktree`,
    )
}

function extractSkill(tag: string | null, skill: string, outDir: string) {
  if (tag === null) {
    const skillRoot = join(REPO_ROOT, SKILLS_DIR, skill)
    cpSync(skillRoot, join(outDir, SKILLS_DIR, skill), {
      recursive: true,
      filter: isVisiblePath(skillRoot),
    })
    return
  }
  const archive = execFileSync('git', ['archive', tag, `${SKILLS_DIR}/${skill}`], {
    cwd: REPO_ROOT,
    maxBuffer: ARCHIVE_MAX_BYTES,
  })
  execFileSync('tar', ['-x', '-C', outDir], { input: archive })
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { tag: { type: 'string' }, worktree: { type: 'boolean' } },
  })
  const connector = positionals[0]
  if (!connector || positionals.length > 1) throw new Error(USAGE)
  if (values.tag !== undefined) {
    if (values.worktree) throw new Error(`${USAGE}\n--tag and --worktree cannot be combined`)
  }

  if (!CONNECTOR_NAME.test(connector))
    throw new Error(
      `invalid connector name "${connector}": use lowercase letters, digits and hyphens`,
    )
  if (connector === BUILD_NAME) throw new Error(`invalid connector name "${connector}"`)

  const sourceDir = join(WORKBUDDY_DIR, connector)
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory())
    throw new Error(`unknown connector "${connector}": ${sourceDir} is not a directory`)

  const metaPath = join(sourceDir, META_FILE)
  const connectorInfo = connectorMeta(readJson<Record<string, unknown>>(metaPath), metaPath)
  const { version } = connectorInfo
  const copiedFiles = [META_FILE, ...connectorFiles(connectorInfo)]
  const missing = copiedFiles.filter((name) => !existsSync(join(sourceDir, name)))
  if (missing.length > 0) throw new Error(`${sourceDir}: missing ${missing.join(', ')}`)
  const meta = readJson<SkillMeta>(join(sourceDir, SKILL_META_FILE))

  const tag = values.worktree ? null : resolveTag(values.tag)
  const source = tag === null ? WORKTREE_LABEL : `tag ${tag}`

  const outDir = join(BUILD_DIR, connector)
  const zipPath = join(BUILD_DIR, `${connector}.zip`)
  rmSync(outDir, { recursive: true, force: true })
  rmSync(zipPath, { force: true })
  mkdirSync(outDir, { recursive: true })

  extractSkill(tag, meta.skill, outDir)

  const skillPath = join(outDir, SKILLS_DIR, meta.skill, SKILL_FILE)
  let skillMd = insertFrontmatter(readFileSync(skillPath, 'utf8'), skillFields(meta, version))
  const introPath = join(sourceDir, SKILL_INTRO_FILE)
  if (existsSync(introPath)) {
    const intro = readFileSync(introPath, 'utf8')
    assertIntroLinksExist(intro, join(outDir, SKILLS_DIR, meta.skill), source)
    skillMd = insertAfterFrontmatter(skillMd, intro)
  }
  writeFileSync(skillPath, skillMd)

  for (const name of copiedFiles) copyFileSync(join(sourceDir, name), join(outDir, name))

  run('zip', ['-r', '-X', `../${connector}.zip`, '.'], outDir)
  const { size } = statSync(zipPath)
  if (size > WORKBUDDY_MAX_PACKAGE_BYTES)
    throw new Error(
      `${zipPath} is ${(size / BYTES_PER_MIB).toFixed(1)} MiB; WorkBuddy accepts at most ${WORKBUDDY_MAX_PACKAGE_BYTES / BYTES_PER_MIB} MiB`,
    )
  process.stdout.write(`${source}\n${zipPath}\n${size} bytes\n`)
}

try {
  main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
