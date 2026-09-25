import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { versionInfo } from '@/version/info'
import { GITHUB_ORIGIN, openGitHub } from './github'

export const SKILL_FILE = 'SKILL.md'
const EXECUTABLE_BITS = 0o111
const URL_RE = /^https?:\/\//

export type SkillEntry = { readonly path: string; readonly executable: boolean }

export type SkillSource = {
  readonly entries: readonly SkillEntry[]
  readonly read: (path: string) => Promise<Uint8Array>
}

export const DEFAULT_SOURCE = `${GITHUB_ORIGIN}/langgenius/dify/tree/${versionInfo.commit}/skills`

export const FROM_FIELD = z
  .string()
  .min(1)
  .default(DEFAULT_SOURCE)
  .describe('Where the skills come from: a GitHub folder URL or a local folder')

async function hasSkillFile(dir: string): Promise<boolean> {
  return stat(join(dir, SKILL_FILE)).then(
    () => true,
    () => false,
  )
}

async function walk(root: string, dir: string): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = []
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const abs = join(entry.parentPath, entry.name)
    const executable = ((await stat(abs)).mode & EXECUTABLE_BITS) !== 0
    entries.push({ path: relative(root, abs).split(sep).join('/'), executable })
  }
  return entries
}

async function openDir(root: string): Promise<SkillSource> {
  let children: Dirent[]
  try {
    children = await readdir(root, { withFileTypes: true })
  } catch (cause) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `cannot read folder "${root}"`,
      cause,
    })
  }
  const dirs = (await hasSkillFile(root))
    ? [root]
    : children.filter((child) => child.isDirectory()).map((child) => join(root, child.name))
  const entries: SkillEntry[] = []
  for (const dir of dirs) if (await hasSkillFile(dir)) entries.push(...(await walk(root, dir)))
  return { entries, read: (path) => readFile(join(root, path)) }
}

export function openSource(from: string): Promise<SkillSource> {
  if (from.startsWith(`${GITHUB_ORIGIN}/`)) return openGitHub(from)
  if (URL_RE.test(from)) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `unsupported --from URL "${from}"`,
      hint: `use a ${GITHUB_ORIGIN} folder URL or a local folder`,
    })
  }
  return openDir(from)
}
