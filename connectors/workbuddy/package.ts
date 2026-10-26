import type { SkillMeta } from './lib.ts'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { insertFrontmatter, latestStableTag, skillFields } from './lib.ts'

const WORKBUDDY_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(WORKBUDDY_DIR, '..', '..')
const BUILD_DIR = join(WORKBUDDY_DIR, 'build')
const ICON_FILES = ['icon.svg', 'icon.png', 'icon.jpg']
const COPIED_FILES = ['connector-meta.json', 'cli.json']

function run(command: string, args: string[], cwd = REPO_ROOT): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { tag: { type: 'string' } },
  })
  const connector = positionals[0]
  if (!connector || positionals.length > 1)
    throw new Error('usage: node package.ts <connector> [--tag <tag>]')

  const sourceDir = join(WORKBUDDY_DIR, connector)
  if (!existsSync(sourceDir))
    throw new Error(`unknown connector "${connector}": ${sourceDir} not found`)

  const { version } = readJson<{ version: string }>(join(sourceDir, 'connector-meta.json'))
  const meta = readJson<SkillMeta>(join(sourceDir, 'skill-meta.json'))

  const tag =
    values.tag ?? latestStableTag(run('git', ['tag', '--list']).split('\n').filter(Boolean))
  try {
    run('git', ['rev-parse', '--verify', `${tag}^{commit}`])
  } catch {
    throw new Error(`tag "${tag}" not found; run git fetch --tags`)
  }

  const outDir = join(BUILD_DIR, connector)
  const zipPath = join(BUILD_DIR, `${connector}.zip`)
  rmSync(outDir, { recursive: true, force: true })
  rmSync(zipPath, { force: true })
  mkdirSync(outDir, { recursive: true })

  const archive = execFileSync('git', ['archive', tag, `skills/${meta.skill}`], {
    cwd: REPO_ROOT,
    maxBuffer: 256 * 1024 * 1024,
  })
  execFileSync('tar', ['-x', '-C', outDir], { input: archive })

  const skillPath = join(outDir, 'skills', meta.skill, 'SKILL.md')
  writeFileSync(
    skillPath,
    insertFrontmatter(readFileSync(skillPath, 'utf8'), skillFields(meta, version)),
  )

  const icon = ICON_FILES.find((name) => existsSync(join(sourceDir, name)))
  if (!icon) throw new Error(`no icon found (${ICON_FILES.join(', ')}) in ${sourceDir}`)
  for (const name of [...COPIED_FILES, icon])
    copyFileSync(join(sourceDir, name), join(outDir, name))

  run('zip', ['-r', '-X', `../${connector}.zip`, '.'], outDir)
  process.stdout.write(`tag ${tag}\n${zipPath}\n`)
}

try {
  main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
