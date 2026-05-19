import type { CommandOutput } from './output.js'
import type { ArgDefinition, FlagDefinition, ICommand, InferArgs, InferFlags, OptionalArgValueType } from './types.js'
import { parseArgv } from './flags.js'

export type CommandConstructor = {
  new(): Command
  description?: string
  flags?: Record<string, FlagDefinition<OptionalArgValueType>>
  args?: Record<string, ArgDefinition<string | undefined>>
  examples?: string[]
  hidden?: boolean
  deprecated?: string
}

type InferCommandArgs<C extends CommandConstructor> = C['args'] extends Record<string, ArgDefinition<string | undefined>>
  ? InferArgs<C['args']>
  : Record<string, string | undefined>

type InferCommandFlags<C extends CommandConstructor> = C['flags'] extends Record<string, FlagDefinition<OptionalArgValueType>>
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

  abstract run(argv: string[]): Promise<CommandOutput | void>

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
