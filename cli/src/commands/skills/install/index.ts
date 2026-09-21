import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode, ExitCode } from '@/errors/codes'
import { Command, Outcome } from '@/plugins/commands/command'
import { io } from '@/plugins/io'
import { runSkillsInstall } from '@/skills/install'
import { versionInfo } from '@/version/info'

const INPUT = z.object({
  dir: z.string().optional(),
  agent: z.array(z.string()).default([]),
  stdout: z.boolean().default(false),
  yes: z.boolean().default(false),
})

export default class SkillsInstall extends Command<typeof INPUT> {
  static override summary = 'Install the difyctl agent skill into detected agent directories'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['dir'] as const
  static override examples = [
    { title: 'Print the skill without installing', input: { stdout: true } },
  ]

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const result = await runSkillsInstall({
      version: versionInfo.version,
      write: input.yes,
      stdout: input.stdout,
      dir: input.dir,
      agents: input.agent,
    })

    if (result.kind === 'usage') {
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: result.message })
    }

    if (input.stdout) {
      const streams = await ctx.get(io)
      await streams.raw(result.text)
      return new Outcome(ExitCode.Success)
    }

    return { wrote: result.wrote, text: result.text }
  }
}
