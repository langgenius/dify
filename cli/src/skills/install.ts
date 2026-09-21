import type { Skill } from './collection'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BASIC_SKILL, findSkill, isScenario, SKILLS } from './collection'

export function selectSkills(names: readonly string[]): Skill[] {
  if (names.length === 0) return [...SKILLS]
  const chosen = new Map(names.map((name) => [name, findSkill(name)]))
  if ([...chosen.values()].some(isScenario)) chosen.set(BASIC_SKILL, findSkill(BASIC_SKILL))
  return [...chosen.values()]
}

export async function installSkills(root: string, skills: readonly Skill[]): Promise<string[]> {
  const wrote: string[] = []
  for (const skill of skills) {
    for (const file of skill.files) {
      const path = join(root, skill.name, file.path)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, file.text, 'utf8')
      wrote.push(path)
    }
  }
  return wrote
}
