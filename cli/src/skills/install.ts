import type { Skill } from './collection'
import type { SkillSource } from './source'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { BASIC_SKILL, findSkill, isScenario } from './collection'

const FILE_MODE = 0o644
const EXECUTABLE_MODE = 0o755

export function selectSkills(skills: readonly Skill[], names: readonly string[]): Skill[] {
  if (names.length === 0) return [...skills]
  const chosen = new Map(names.map((name) => [name, findSkill(skills, name)]))
  const basic = skills.find((skill) => skill.name === BASIC_SKILL)
  if (basic !== undefined && [...chosen.values()].some(isScenario)) chosen.set(BASIC_SKILL, basic)
  return [...chosen.values()]
}

export async function installSkills(
  root: string,
  skills: readonly Skill[],
  source: SkillSource,
): Promise<string[]> {
  const downloads = []
  for (const skill of skills) {
    for (const file of skill.files)
      downloads.push({ skill, file, bytes: await source.read(posix.join(skill.dir, file.path)) })
  }
  for (const skill of skills) await rm(join(root, skill.name), { recursive: true, force: true })
  const wrote: string[] = []
  for (const { skill, file, bytes } of downloads) {
    const path = join(root, skill.name, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes, { mode: file.executable ? EXECUTABLE_MODE : FILE_MODE })
    wrote.push(path)
  }
  return wrote
}
