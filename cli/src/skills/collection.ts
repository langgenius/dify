import type { SkillFile, SkillSource } from './source'
import { BaseError, unknownError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { SKILL_SOURCES } from './collection.generated'
import { parseFrontmatter } from './frontmatter'
import { SKILL_FILE } from './source'

export type Skill = {
  readonly name: string
  readonly description: string
  readonly files: readonly SkillFile[]
}

export const BASIC_SKILL = 'difyctl'

function toSkill(source: SkillSource): Skill {
  const skillFile = source.files.find((file) => file.path === SKILL_FILE)
  const meta = parseFrontmatter(skillFile?.text ?? '')
  if (typeof meta.description !== 'string')
    throw unknownError(`skill ${source.name}: frontmatter description missing`)
  return { name: source.name, description: meta.description, files: source.files }
}

export const SKILLS: readonly Skill[] = SKILL_SOURCES.map(toSkill)

export function isScenario(skill: Skill): boolean {
  return skill.name !== BASIC_SKILL
}

export function findSkill(name: string): Skill {
  const skill = SKILLS.find((candidate) => candidate.name === name)
  if (skill === undefined) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `unknown skill "${name}"`,
      hint: `known skills: ${SKILLS.map((candidate) => candidate.name).join(', ')}`,
    })
  }
  return skill
}
