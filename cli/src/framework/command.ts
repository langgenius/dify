import type { ArgDefinition, FlagDefinition, ICommand, InferArgs, InferFlags } from './types.js'
import { parseArgv } from './flags.js'

export type CommandConstructor = {
  new(): Command
  description?: string
  flags?: Record<string, FlagDefinition<string | boolean | number | undefined>>
  args?: Record<string, ArgDefinition<string | undefined>>
  examples?: string[]
}

type ParseResult<C extends CommandConstructor> = {
  args: C['args'] extends Record<string, ArgDefinition<string | undefined>> ? InferArgs<C['args']> : Record<string, string | undefined>
  flags: C['flags'] extends Record<string, FlagDefinition<string | boolean | number | undefined>> ? InferFlags<C['flags']> : Record<string, string | boolean | number | undefined>
}

export abstract class Command implements ICommand {
  static description?: string
  static flags: Record<string, FlagDefinition<string | boolean | number | undefined>> = {}
  static args: Record<string, ArgDefinition<string | undefined>> = {}
  static examples: string[] = []

  private _argv: readonly string[] = []

  _setArgv(argv: readonly string[]): void {
    this._argv = argv
  }

  abstract run(): Promise<void>

  protected parse<C extends CommandConstructor>(ctor: C): ParseResult<C> {
    const meta = {
      flags: ctor.flags ?? {},
      args: ctor.args ?? {},
    }

    return parseArgv(this._argv, meta) as ParseResult<C>
  }

  protected log(message: string): void {
    process.stdout.write(`${message}\n`)
  }

  error(message: string, opts?: { exit?: number }): never {
    process.stderr.write(`${message}\n`)
    process.exit(opts?.exit ?? 1)
  }
}
