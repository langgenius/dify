import { SKILL_TEMPLATE } from './skill-template'

export type RenderSkillOptions = {
  readonly version: string
}

export function renderSkill(opts: RenderSkillOptions): string {
  return SKILL_TEMPLATE.replaceAll('{{VERSION}}', opts.version)
}
