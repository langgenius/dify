import type { CommandEffect } from '@/framework/command'
import type { CommandOutput } from '@/framework/output'
import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/framework/command'
import { Args, Flags } from '@/framework/flags'
import { raw } from '@/framework/output'
import { versionInfo } from '@/version/info'
import { runSkillsInstall } from './run'

export default class SkillsInstall extends Command {
  static override description = 'Install the difyctl agent skill (SKILL.md) into detected agents'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> skills install',
    '<%= config.bin %> skills install --yes',
    '<%= config.bin %> skills install --yes --agent claude-code',
    '<%= config.bin %> skills install ./my-skills/difyctl --yes',
    '<%= config.bin %> skills install --stdout',
  ]

  static override args = {
    dir: Args.string({ description: 'force install into a single explicit directory (bypasses detection)' }),
  }

  static override flags = {
    yes: Flags.boolean({ char: 'y', description: 'write the skill (otherwise dry-run)', default: false }),
    agent: Flags.stringArray({ description: 'restrict to specific detected agents (repeatable or comma-separated)', default: [], multiple: true }),
    stdout: Flags.boolean({ description: 'print SKILL.md to stdout and write nothing', default: false }),
  }

  async run(argv: string[]): Promise<CommandOutput> {
    const { args, flags } = this.parse(SkillsInstall, argv)

    const dir = args.dir
    const hasDir = dir !== undefined && dir !== ''
    const agents = flags.agent.flatMap(a => a.split(',')).map(s => s.trim()).filter(s => s.length > 0)

    if (flags.stdout && (flags.yes || hasDir || agents.length > 0))
      throw newError(ErrorCode.IllegalArgumentError, '--stdout writes nothing; do not combine it with --yes, --agent, or [dir]')

    if (hasDir && agents.length > 0)
      throw newError(ErrorCode.IllegalArgumentError, 'pass either [dir] or --agent, not both')

    const result = await runSkillsInstall({
      version: versionInfo.version,
      write: flags.yes,
      stdout: flags.stdout,
      dir,
      agents,
    })

    if (result.kind === 'usage')
      throw newError(ErrorCode.IllegalArgumentError, result.message)

    return raw(result.text)
  }
}
