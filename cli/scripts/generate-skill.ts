import type { SkillFile } from '../src/help/skill.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type PackageManifest = {
  readonly version: string
  readonly difyctl?: {
    readonly channel?: string
    readonly compat?: { readonly minDify?: string, readonly maxDify?: string }
  }
}

// The command tree pulls in modules that read vite `define` globals at load
// time. They are absent under a bare `bun` run, so seed them from the manifest
// before importing anything that touches the tree. Mirrors test/setup.ts.
function seedBuildGlobals(pkg: PackageManifest): void {
  const g = globalThis as unknown as Record<string, string>
  g.__DIFYCTL_VERSION__ = pkg.version
  g.__DIFYCTL_COMMIT__ = '0000000'
  g.__DIFYCTL_BUILD_DATE__ = '1970-01-01T00:00:00.000Z'
  g.__DIFYCTL_CHANNEL__ = pkg.difyctl?.channel ?? 'dev'
  g.__DIFYCTL_MIN_DIFY__ = pkg.difyctl?.compat?.minDify ?? '0.0.0'
  g.__DIFYCTL_MAX_DIFY__ = pkg.difyctl?.compat?.maxDify ?? '0.0.0'
}

async function renderFiles(version: string): Promise<SkillFile[]> {
  // Dynamic imports so seedBuildGlobals() runs before module evaluation.
  const { commandTree } = await import('@/commands/tree.generated')
  const { renderSkill } = await import('@/help/skill')
  return renderSkill(commandTree, { version })
}

function shortDiff(a: string, b: string): string {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const lines: string[] = []
  const max = Math.max(aLines.length, bLines.length)
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      if (aLines[i] !== undefined)
        lines.push(`- ${aLines[i]}`)
      if (bLines[i] !== undefined)
        lines.push(`+ ${bLines[i]}`)
    }
  }
  return lines.slice(0, 40).join('\n')
}

export type GenerateSkillResult
  = | { mode: 'write', wrote: string[] }
    | { mode: 'check', ok: true }
    | { mode: 'check', ok: false, path: string, diff: string }

export async function generateSkill(opts: {
  files: SkillFile[]
  outDir: string
  mode: 'write' | 'check'
}): Promise<GenerateSkillResult> {
  if (opts.mode === 'check') {
    for (const file of opts.files) {
      const target = join(opts.outDir, file.path)
      let onDisk = ''
      try {
        onDisk = await readFile(target, 'utf8')
      }
      catch {
        onDisk = ''
      }
      if (onDisk !== file.content)
        return { mode: 'check', ok: false, path: target, diff: shortDiff(onDisk, file.content) }
    }
    return { mode: 'check', ok: true }
  }

  const wrote: string[] = []
  for (const file of opts.files) {
    const target = join(opts.outDir, file.path)
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.tmp-${process.pid}-${process.hrtime.bigint()}`
    await writeFile(tmp, file.content, 'utf8')
    await rename(tmp, target)
    wrote.push(target)
  }
  return { mode: 'write', wrote }
}

async function main(): Promise<void> {
  const here = fileURLToPath(import.meta.url)
  const cliRoot = join(here, '..', '..')
  const pkg = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8')) as PackageManifest

  seedBuildGlobals(pkg)

  const files = await renderFiles(pkg.version)
  const outDir = join(cliRoot, 'skill')
  const checkMode = process.argv.includes('--check')
  const result = await generateSkill({ files, outDir, mode: checkMode ? 'check' : 'write' })

  if (result.mode === 'write') {
    process.stderr.write(`skill:gen wrote ${result.wrote.length} file(s) under ${outDir}\n`)
    return
  }
  if (result.ok) {
    process.stderr.write(`skill:check ok\n`)
    return
  }
  process.stderr.write(
    `skill:check FAILED — ${result.path} is stale.\nDiff (first 40 lines):\n${result.diff}\n\nRun \`pnpm skill:gen\` and commit.\n`,
  )
  process.exit(1)
}

const invokedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly)
  await main()
