export type SkillFile = { readonly path: string; readonly text: string }
export type SkillSource = { readonly name: string; readonly files: readonly SkillFile[] }

export const SKILL_FILE = 'SKILL.md'
