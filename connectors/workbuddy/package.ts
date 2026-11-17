import type { SkillMeta } from './lib.ts'
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
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  connectorFiles,
  connectorMeta,
  insertAfterFrontmatter,
  insertFrontmatter,
  latestStableTag,
  skillFields,
} from './lib.ts'

const WORKBUDDY_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(WORKBUDDY_DIR, '..', '..')
const BUILD_NAME = 'build'
const CONNECTOR_NAME = /^[a-z0-9][a-z0-9-]*$/
const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024
const BUILD_DIR = join(WORKBUDDY_DIR, BUILD_NAME)
const ICON_FILES = ['icon.svg', 'icon.png', 'icon.jpg']
const META_FILE = 'connector-meta.json'
const USAGE = 'usage: node package.ts <connector> [--tag <tag> | --worktree]'
const WORKTREE_LABEL = 'worktree'
const SKILL_INTRO_FILE = 'skill-intro.md'

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

function extractSkill(tag: string | null, skill: string, outDir: string) {
  if (tag === null) {
    cpSync(join(REPO_ROOT, 'skills', skill), join(outDir, 'skills', skill), { recursive: true })
    return
  }
  const archive = execFileSync('git', ['archive', tag, `skills/${skill}`], {
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
  if (values.tag !== undefined && values.worktree)
    throw new Error(`${USAGE}\n--tag and --worktree cannot be combined`)

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
  if (missing.length > 0)
    throw new Error(
      `${sourceDir}: missing ${missing.join(', ')} for a "${connectorInfo.type}" connector`,
    )
  const meta = readJson<SkillMeta>(join(sourceDir, 'skill-meta.json'))

  const tag = values.worktree ? null : resolveTag(values.tag)

  const outDir = join(BUILD_DIR, connector)
  const zipPath = join(BUILD_DIR, `${connector}.zip`)
  rmSync(outDir, { recursive: true, force: true })
  rmSync(zipPath, { force: true })
  mkdirSync(outDir, { recursive: true })

  extractSkill(tag, meta.skill, outDir)

  const skillPath = join(outDir, 'skills', meta.skill, 'SKILL.md')
  let skillMd = insertFrontmatter(readFileSync(skillPath, 'utf8'), skillFields(meta, version))
  const introPath = join(sourceDir, SKILL_INTRO_FILE)
  if (existsSync(introPath))
    skillMd = insertAfterFrontmatter(skillMd, readFileSync(introPath, 'utf8'))
  writeFileSync(skillPath, skillMd)

  const icon = ICON_FILES.find((name) => existsSync(join(sourceDir, name)))
  if (!icon) throw new Error(`no icon found (${ICON_FILES.join(', ')}) in ${sourceDir}`)
  for (const name of [...copiedFiles, icon]) copyFileSync(join(sourceDir, name), join(outDir, name))

  run('zip', ['-r', '-X', `../${connector}.zip`, '.'], outDir)
  process.stdout.write(`${tag === null ? WORKTREE_LABEL : `tag ${tag}`}\n${zipPath}\n`)
}

try {
  main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
