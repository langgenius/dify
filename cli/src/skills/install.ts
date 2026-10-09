import type { SkillSource } from './source'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SKILL_NAME } from './source'

const EXECUTABLE_MODE = 0o755
const FILE_MODE = 0o644
const SHEBANG = [0x23, 0x21]

function modeFor(bytes: Uint8Array): number {
  return SHEBANG.every((byte, i) => bytes[i] === byte) ? EXECUTABLE_MODE : FILE_MODE
}

export async function installSkill(root: string, source: SkillSource): Promise<string[]> {
  const files = await Promise.all(
    source.paths.map(async (path) => ({ path, bytes: await source.read(path) })),
  )
  const target = join(root, SKILL_NAME)
  await rm(target, { recursive: true, force: true })
  const wrote: string[] = []
  for (const { path, bytes } of files) {
    const abs = join(target, path)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, bytes, { mode: modeFor(bytes) })
    wrote.push(abs)
  }
  return wrote
}
