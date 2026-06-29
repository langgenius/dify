import { SKILL_TEMPLATE } from './skill-template'

export type RenderSkillOptions = {
  readonly version: string
}

// Renders the difyctl SKILL.md by substituting only the version stamp into the
// hand-authored, pure-delegation template. There is no command-tree walk: the
// skill points agents at `difyctl help -o json` for the live command surface
// rather than enumerating it, so there is nothing to derive and nothing to
// drift. The single file is what `skills install` writes / prints.
export function renderSkill(opts: RenderSkillOptions): string {
  return SKILL_TEMPLATE.replaceAll('{{VERSION}}', opts.version)
}
