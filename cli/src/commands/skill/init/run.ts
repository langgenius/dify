import type { CommandTree } from '@/framework/registry'
import type { SkillFile } from '@/help/skill'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderSkill } from '@/help/skill'

// Default install location, relative to the project (or home with --user). The
// `.claude/skills/` prefix is Claude Code's convention; the SKILL.md itself is
// cross-agent, so this is just the portable baseline destination.
const SKILL_SUBDIR = '.claude/skills/difyctl'

export type ResolveSkillDirOptions = {
  readonly dir?: string
  readonly user?: boolean
  readonly home?: string
  readonly cwd?: string
}

export function resolveSkillDir(opts: ResolveSkillDirOptions): string {
  if (opts.dir !== undefined && opts.dir !== '')
    return resolve(opts.dir)

  const base = opts.user === true ? (opts.home ?? homedir()) : (opts.cwd ?? process.cwd())
  return join(base, SKILL_SUBDIR)
}

export async function writeSkillFiles(files: readonly SkillFile[], outDir: string): Promise<string[]> {
  const wrote: string[] = []
  for (const file of files) {
    const target = join(outDir, file.path)
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.tmp-${process.pid}-${process.hrtime.bigint()}`
    await writeFile(tmp, file.content, 'utf8')
    await rename(tmp, target)
    wrote.push(target)
  }
  return wrote
}

export type SkillInitOptions = {
  readonly outDir: string
  readonly version: string
  readonly tree: CommandTree
}

export type SkillInitResult = {
  readonly dir: string
  readonly wrote: readonly string[]
}

export async function runSkillInit(opts: SkillInitOptions): Promise<SkillInitResult> {
  const files = renderSkill(opts.tree, { version: opts.version })
  const wrote = await writeSkillFiles(files, opts.outDir)
  return { dir: opts.outDir, wrote }
}
