import { resolve } from 'node:path'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { installSkill } from '@/skills/install'
import { FROM_FIELD, openSource } from '@/skills/source'

const INPUT = z.object({
  dir: z
    .string()
    .min(1)
    .describe("The agent's skills root: the folder that holds one subfolder per skill"),
  from: FROM_FIELD,
})

export default class SkillsInstall extends Command<typeof INPUT> {
  static override summary = 'Write the difyctl skill into a skills root'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['dir'] as const
  static override examples = [
    { title: 'Install the skill for Claude Code', input: { dir: '~/.claude/skills' } },
  ]

  async run(input: z.infer<typeof INPUT>) {
    return { wrote: await installSkill(resolve(input.dir), await openSource(input.from)) }
  }
}
