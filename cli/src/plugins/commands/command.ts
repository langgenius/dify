import type { ExitCodeValue } from '@/errors/codes'
import type { CommandContext } from '@/plugins/base'
import type { Example } from '@/plugins/catalog'
import type { Printable } from '@/plugins/io'
import { z } from 'zod'
import { commandRow } from './describe'

export type CommandEffect = 'read' | 'write' | 'destructive'

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
  static effect: CommandEffect = 'read'
  static input: z.ZodObject = z.object({})
  static positional: readonly string[] = []
  static examples: readonly Example[] = []
  static hidden?: boolean

  static async help(this: CommandConstructor, args: HelpArgs): Promise<Printable> {
    return commandRow(this, args.path)
  }

  abstract run(input: z.infer<S>, ctx: CommandContext): Promise<CommandResult>
}

// `Omit` drops the abstract construct signature (and the generic `S` with it), so the
// registry can hold and instantiate any concrete subclass while keeping the statics.
export type CommandConstructor = Omit<typeof Command, 'prototype'> & (new () => Command)
