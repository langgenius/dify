import type { SkillEntry, SkillSource } from './source'
import { posix } from 'node:path'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { parseFrontmatter } from './frontmatter'
import { SKILL_FILE } from './source'

export const BASIC_SKILL = 'difyctl'
const ROOT_DIR = '.'
const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/

export type Skill = {
  readonly name: string
  readonly description: string
  readonly dir: string
  readonly files: readonly SkillEntry[]
}

function skillDirs(entries: readonly SkillEntry[]): string[] {
  const dirs = entries
    .filter(
      (entry) => entry.path.split('/').length <= 2 && posix.basename(entry.path) === SKILL_FILE,
    )
    .map((entry) => posix.dirname(entry.path))
  return dirs.includes(ROOT_DIR) ? [ROOT_DIR] : dirs
}

function filesIn(entries: readonly SkillEntry[], dir: string): SkillEntry[] {
  return entries
    .filter((entry) => dir === ROOT_DIR || entry.path.startsWith(`${dir}/`))
    .map((entry) => ({
      ...entry,
      path: dir === ROOT_DIR ? entry.path : entry.path.slice(dir.length + 1),
    }))
}

async function loadSkill(source: SkillSource, dir: string): Promise<Skill> {
  const path = posix.join(dir, SKILL_FILE)
  const meta = parseFrontmatter(new TextDecoder().decode(await source.read(path)))
  const { name, description } = meta
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name) || typeof description !== 'string') {
    throw new BaseError({
      code: ErrorCode.ServerError,
      message: `${path}: frontmatter needs a name (lowercase letters, digits, dashes) and a description`,
    })
  }
  return { name, description, dir, files: filesIn(source.entries, dir) }
}

export async function loadSkills(source: SkillSource): Promise<Skill[]> {
  const skills = await Promise.all(skillDirs(source.entries).map((dir) => loadSkill(source, dir)))
  if (skills.length === 0) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: 'no skills found',
      hint: 'point --from at a folder of skills, or at one skill folder',
    })
  }
  return skills
}

export function isScenario(skill: Skill): boolean {
  return skill.name !== BASIC_SKILL
}

export function findSkill(skills: readonly Skill[], name: string): Skill {
  const skill = skills.find((candidate) => candidate.name === name)
  if (skill === undefined) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `unknown skill "${name}"`,
      hint: `known skills: ${skills.map((candidate) => candidate.name).join(', ')}`,
    })
  }
  return skill
}
