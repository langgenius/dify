import type { Descriptor, OpFacets } from './describe'
import type { ExitCodeValue } from '@/errors/codes'
import type { CommandContext } from '@/plugins/base'
import type { Example, JsonSchema } from '@/plugins/catalog'
import type { Printable } from '@/sys/io/view'
import { z } from 'zod'
import { validateInput } from '@/call/validate'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { inputSchema } from '@/plugins/argv/parse'
import { COMMAND_SEPARATOR } from '@/protocol/op-id'
import { BINARY } from '@/version/info'
import { commandRow } from './describe'

export type { Descriptor, OpFacets } from './describe'

export type CommandEffect = 'read' | 'write' | 'destructive'

export const HELP_WORD = 'help'

/** Points at the help for `words`, or at the map when nothing is named. */
export function helpHint(...words: readonly string[]): string {
  return ['run', BINARY, HELP_WORD, ...words].join(COMMAND_SEPARATOR)
}

/** Returned by a command that already wrote its output or needs a non-zero exit. */
export class Outcome {
  readonly code: ExitCodeValue
  readonly body?: Printable

  constructor(code: ExitCodeValue, body?: Printable) {
    this.code = code
    this.body = body
  }
}

export type CommandResult = Printable | Outcome | undefined

export type HelpArgs = {
  readonly path: readonly string[]
  readonly rest: readonly string[]
  readonly ctx: CommandContext
}

export abstract class Command<S extends z.ZodObject = z.ZodObject> {
  static summary = ''
  static effect: CommandEffect | undefined = 'read'
  static input: z.ZodObject = z.object({})
  static positional: readonly string[] = []
  static examples: readonly Example[] = []
  static hidden?: boolean

  static schema(this: CommandConstructor): JsonSchema {
    return inputSchema(this.input)
  }

  static flags(this: CommandConstructor): JsonSchema {
    return this.schema()
  }

  static facets(): Partial<OpFacets> {
    return {}
  }

  // The one input gate. parseArgv only coerces what was typed; zod owns the declared
  // defaults, so reaching its parse means a zod rejection is a schema/parser contract bug.
  static finalize(
    this: CommandConstructor,
    input: Record<string, unknown>,
    path: readonly string[],
  ): Record<string, unknown> {
    const schema = this.schema()
    const details = validateInput(schema, input)
    if (details.length > 0) {
      throw new BaseError({
        code: ErrorCode.InputInvalid,
        message: `invalid input for "${path.join(COMMAND_SEPARATOR)}"`,
        hint: helpHint(...path),
        details: [...details],
        schema,
      })
    }
    const parsed = this.input.safeParse(input)
    if (!parsed.success) {
      throw new BaseError({
        code: ErrorCode.Unknown,
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        cause: parsed.error,
      })
    }
    return parsed.data
  }

  static async help(this: CommandConstructor, args: HelpArgs): Promise<Descriptor> {
    return { ...commandRow(this, args.path), ...this.facets() }
  }

  abstract run(input: z.infer<S>, ctx: CommandContext): Promise<CommandResult>
}

// `Omit` drops the abstract construct signature (and the generic `S` with it), so the
// registry can hold and instantiate any concrete subclass while keeping the statics.
export type CommandConstructor = Omit<typeof Command, 'prototype'> & (new () => Command)
