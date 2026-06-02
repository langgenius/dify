import type { CommandEffect } from '@/framework/command'
import type { CommandOutput } from '@/framework/output'
import { commandTree } from '@/commands/tree'
import { ExitCode } from '@/errors/codes'
import { Command } from '@/framework/command'
import { Args, Flags } from '@/framework/flags'
import { raw } from '@/framework/output'
import { versionInfo } from '@/version/info'
import { resolveSkillDir, runSkillInit } from './run'

export default class SkillInit extends Command {
  static override description = 'Generate the difyctl agent skill (SKILL.md + reference/) into a skills directory'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> skill init',
    '<%= config.bin %> skill init ./my-skills/difyctl',
    '<%= config.bin %> skill init --user',
  ]

  static override args = {
    dir: Args.string({ description: 'target directory (default: ./.claude/skills/difyctl)' }),
  }

  static override flags = {
    user: Flags.boolean({ description: 'write to ~/.claude/skills/difyctl instead of the project directory', default: false }),
  }

  async run(argv: string[]): Promise<CommandOutput> {
    const { args, flags } = this.parse(SkillInit, argv)

    if (args.dir !== undefined && args.dir !== '' && flags.user)
      this.error('pass either [dir] or --user, not both', { exit: ExitCode.Usage })

    const outDir = resolveSkillDir({ dir: args.dir, user: flags.user })
    const result = await runSkillInit({ outDir, version: versionInfo.version, tree: commandTree })

    return raw(`Wrote difyctl skill (${result.wrote.length} files) to ${result.dir}\n`)
  }
}
