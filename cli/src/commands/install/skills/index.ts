import { resolve } from 'node:path'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { loadSkills } from '@/skills/collection'
import { installSkills, selectSkills } from '@/skills/install'
import { FROM_FIELD, openSource } from '@/skills/source'

const INPUT = z.object({
  dir: z
    .string()
    .min(1)
    .describe("The agent's skills root: the folder that holds one subfolder per skill"),
  skill: z
    .array(z.string())
    .default([])
    .describe('Skill to install (repeatable); default: the whole collection'),
  from: FROM_FIELD,
})

export default class SkillsInstall extends Command<typeof INPUT> {
  static override summary = 'Write skills from the collection into a skills root'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['dir'] as const
  static override examples = [
    { title: 'Install every skill for Claude Code', input: { dir: '~/.claude/skills' } },
    { title: 'Install one skill for Codex', input: { dir: '~/.codex/skills', skill: ['difyctl'] } },
  ]

  async run(input: z.infer<typeof INPUT>) {
    const source = await openSource(input.from)
    const skills = selectSkills(await loadSkills(source), input.skill)
    return { wrote: await installSkills(resolve(input.dir), skills, source) }
  }
}
