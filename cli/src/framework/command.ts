import type { CommandOutput } from './output'
import type {
  ArgDefinition,
  FlagDefinition,
  ICommand,
  InferArgs,
  InferFlags,
  OptionalArgValueType,
} from './types'
import { setVerbose } from './context'
import { hasBooleanFlag, parseArgv, VERBOSE_CHAR, VERBOSE_FLAG } from './flags'

// What invoking a command does to remote/persistent state. Drives the skill's
// safety section and the `effect` bit in machine-readable help. Defaults to
// `read`; write/destructive commands must opt in explicitly.
export type CommandEffect = 'read' | 'write' | 'destructive'

export type CommandConstructor = {
  new (): Command
  description?: string
  flags?: Record<string, FlagDefinition<OptionalArgValueType>>
  args?: Record<string, ArgDefinition<string | undefined>>
  examples?: string[]
  hidden?: boolean
  deprecated?: string
  effect?: CommandEffect
}

type InferCommandArgs<C extends CommandConstructor> =
  C['args'] extends Record<string, ArgDefinition<string | undefined>>
    ? InferArgs<C['args']>
    : Record<string, string | undefined>

type InferCommandFlags<C extends CommandConstructor> =
  C['flags'] extends Record<string, FlagDefinition<OptionalArgValueType>>
    ? InferFlags<C['flags']>
    : Record<string, OptionalArgValueType>

type ParseResult<C extends CommandConstructor> = {
  args: InferCommandArgs<C>
  flags: InferCommandFlags<C>
}

export abstract class Command implements ICommand {
  static description?: string
  static flags: Record<string, FlagDefinition<OptionalArgValueType>> = {}

  static args: Record<string, ArgDefinition<string | undefined>> = {}
  static examples: string[] = []
  static effect: CommandEffect = 'read'

  abstract run(argv: string[]): Promise<CommandOutput | void>

  processGlobalFlags(argv: readonly string[]): void {
    setVerbose(hasBooleanFlag(argv, VERBOSE_FLAG, VERBOSE_CHAR))
  }

  protected parse<C extends CommandConstructor>(ctor: C, argv: string[]): ParseResult<C> {
    const meta = {
      flags: ctor.flags ?? {},
      args: ctor.args ?? {},
    }

    return parseArgv(argv, meta) as ParseResult<C>
  }

  error(message: string, opts?: { exit?: number }): never {
    process.stderr.write(`${message}\n`)
    process.exit(opts?.exit ?? 1)
  }

  agentGuide(): string {
    return ''
  }
}
