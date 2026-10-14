import type { CommandContext } from '@/plugins/base'
import type { CatalogOp, JsonSchema } from '@/plugins/catalog'
import type {
  CommandConstructor,
  CommandEffect,
  Descriptor,
  HelpArgs,
  OpFacets,
} from '@/plugins/commands/command'
import { executeCall } from '@/call/execute'
import { CALL_FLAG, CALL_FLAG_SCHEMA, CALL_FLAGS, callOptionsSchema } from '@/call/flags'
import { Command, HELP_WORD } from '@/plugins/commands/command'
import { GLOBAL_INPUT } from '@/plugins/global-flags'
import { propertiesOf } from '@/protocol/shape'
import { pinsFor } from './pins'

const OBJECT_SCHEMA_TYPE = 'object'

/**
 * Flag names the CLI owns: an op field by one of these names cannot be typed. The help
 * word is one of them — the pipeline answers it before a command ever runs.
 */
export const RESERVED_FLAGS: readonly string[] = [
  ...Object.values(CALL_FLAG),
  ...Object.keys(GLOBAL_INPUT.shape),
  HELP_WORD,
]

const METHOD_EFFECT: Readonly<Record<string, CommandEffect>> = {
  GET: 'read',
  HEAD: 'read',
  POST: 'write',
  PUT: 'write',
  PATCH: 'write',
  DELETE: 'destructive',
}

export function effectOf(method: string): CommandEffect | undefined {
  return METHOD_EFFECT[method.toUpperCase()]
}

// Parse-only: the op's own fields minus the reserved names, plus the call options its
// kind accepts. `required` is left out on purpose — executeCall validates the assembled
// body against the op's real schema, which the fields alone do not have to satisfy.
function flagSchema(op: CatalogOp, options: JsonSchema): JsonSchema {
  const fields = Object.entries(propertiesOf(op.input)).filter(
    ([name]) => !RESERVED_FLAGS.includes(name),
  )
  return {
    type: OBJECT_SCHEMA_TYPE,
    properties: { ...Object.fromEntries(fields), ...propertiesOf(options) },
  }
}

export function opCommand(id: string, op: CatalogOp): CommandConstructor {
  const options = callOptionsSchema(op.kind)
  const parseSchema = flagSchema(op, options)
  return class OpCommand extends Command {
    static override summary = op.summary
    static override effect = effectOf(op.method)
    static override positional = [] as const
    static override examples = op.examples
    static override hidden = op.internal

    static override schema(): JsonSchema {
      return op.input
    }

    static override flags(): JsonSchema {
      return parseSchema
    }

    static override facets(): Partial<OpFacets> {
      return {
        op: id,
        method: op.method,
        path: op.path,
        kind: op.kind,
        bind: op.bind,
        deprecated: op.deprecated,
        options,
      }
    }

    // Every declared default belongs to the server's schema, so what was typed stands.
    static override finalize(input: Record<string, unknown>): Record<string, unknown> {
      return input
    }

    static override async help(args: HelpArgs): Promise<Descriptor> {
      const row = await super.help(args)
      const pins = await pinsFor(op, args.ctx)
      return pins === undefined ? row : { ...row, pins }
    }

    // The parser only accepts what `parseSchema` declares, so the input splits cleanly:
    // the CLI's own flags on one side, this op's fields on the other.
    async run(input: Record<string, unknown>, ctx: CommandContext) {
      const flags = CALL_FLAG_SCHEMA.parse(input)
      const fields = Object.fromEntries(
        Object.entries(input).filter(([key]) => !(key in CALL_FLAGS)),
      )
      return executeCall({ id, op, flags, fields }, ctx)
    }
  }
}
