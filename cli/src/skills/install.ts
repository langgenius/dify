import type { SkillSource } from './source'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SKILL_NAME } from './source'

export async function installSkill(root: string, source: SkillSource): Promise<string[]> {
  const files = await Promise.all(
    source.paths.map(async (path) => ({ path, file: await source.read(path) })),
  )
  const target = join(root, SKILL_NAME)
  await rm(target, { recursive: true, force: true })
  const wrote: string[] = []
  for (const { path, file } of files) {
    const abs = join(target, path)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, file.bytes, { mode: file.mode })
    wrote.push(abs)
  }
  return wrote
}
