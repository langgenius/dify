import type { EmbeddedFile } from '@/sys'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { embeddedFiles, isCompiledBinary } from '@/sys'

export const SKILL_NAME = 'difyctl'
export const SKILL_FILE = 'SKILL.md'
const EMBED_PREFIX = `${SKILL_NAME}/`
const REPO_SKILL_DIR = fileURLToPath(new URL(`../../../skills/${EMBED_PREFIX}`, import.meta.url))
const NO_EMBEDDED_SKILL =
  'this difyctl build has no embedded skill; reinstall difyctl or pass --from <folder>'

export type SkillSource = {
  readonly paths: readonly string[]
  readonly read: (path: string) => Promise<Uint8Array>
}

export const FROM_FIELD = z
  .string()
  .min(1)
  .optional()
  .describe('A local skill folder to install instead of the one built into difyctl')

export async function openDir(root: string): Promise<SkillSource> {
  const found = await stat(join(root, SKILL_FILE)).then(
    () => true,
    () => false,
  )
  if (!found) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `no ${SKILL_FILE} in "${root}"`,
    })
  }
  const paths: string[] = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile())
      paths.push(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
  }
  return { paths, read: (path) => readFile(join(root, path)) }
}

function embeddedSource(files: readonly EmbeddedFile[]): SkillSource {
  const byPath = new Map(files.map((file) => [file.name.slice(EMBED_PREFIX.length), file]))
  return {
    paths: [...byPath.keys()],
    read: async (path) => {
      const file = byPath.get(path)
      if (file === undefined)
        throw new BaseError({
          code: ErrorCode.SkillMissing,
          message: `the embedded skill has no ${path}`,
        })
      return new Uint8Array(await file.arrayBuffer())
    },
  }
}

async function defaultSource(): Promise<SkillSource> {
  const files = embeddedFiles().filter((file) => file.name.startsWith(EMBED_PREFIX))
  if (files.length > 0) return embeddedSource(files)
  if (isCompiledBinary())
    throw new BaseError({ code: ErrorCode.SkillMissing, message: NO_EMBEDDED_SKILL })
  return openDir(REPO_SKILL_DIR)
}

export function openSource(from: string | undefined): Promise<SkillSource> {
  return from === undefined ? defaultSource() : openDir(from)
}
