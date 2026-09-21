import type { CommandContext } from '@/plugins/base'
import type { CommandConstructor } from '@/plugins/commands/command'
import type { CommandRow } from '@/plugins/commands/describe'
import type { CommandNode, CommandTree } from '@/plugins/commands/registry'
import type { IOService } from '@/plugins/io'
import type { OpListRow } from '@/plugins/ops'
import { validateInput } from '@/call/validate'
import { commandTree } from '@/commands/tree'
import { BaseError } from '@/errors/base'
import { ErrorCode, ExitCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { definePlugin } from '@/kernel/plugin'
import { inputSchema, parseArgv } from '@/plugins/argv/parse'
import { BASE_PLUGINS } from '@/plugins/base'
import { Outcome } from '@/plugins/commands/command'
import { treeRows } from '@/plugins/commands/describe'
import { findSuggestions, resolveCommand } from '@/plugins/commands/registry'
import { globalFlags } from '@/plugins/global-flags'
import { io } from '@/plugins/io'
import { ops } from '@/plugins/ops'
import { session } from '@/plugins/session'
import { BINARY } from '@/version/info'

export type CommandsService = {
  readonly run: () => Promise<number>
}

const HELP_WORD = 'help'
const HELP_FLAGS: readonly string[] = ['--help', '-h']
const FLAG_PREFIX = '-'
const NO_SERVER_NOTICE = 'log in to list server operations'
const OPS_UNAVAILABLE_PREFIX = 'could not list server operations: '

type RootHelp = { commands: CommandRow[]; ops?: OpListRow[] }

function isWord(token: string): boolean {
  return !token.startsWith(FLAG_PREFIX)
}

function withoutHelpWord(argv: readonly string[]): readonly string[] {
  const at = argv.findIndex(isWord)
  return at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 1)]
}

// Everything after the last word the tree matched — by position, so a flag written
// before the command words does not shift the slice.
function restAfterPath(tokens: readonly string[], pathLength: number): readonly string[] {
  let matched = 0
  for (const [index, token] of tokens.entries()) {
    if (!isWord(token)) continue
    matched += 1
    if (matched === pathLength) return tokens.slice(index + 1)
  }
  return []
}

async function rootHelp(
  tree: CommandTree,
  ctx: CommandContext,
  streams: IOService,
): Promise<number> {
  const body: RootHelp = { commands: treeRows(tree) }
  const login = await (await ctx.get(session)).current()
  if (login === null) {
    streams.notice(NO_SERVER_NOTICE)
  } else {
    // An unreachable server must not cost the caller the static command list.
    try {
      body.ops = await (await ctx.get(ops)).list({ includeInternal: false })
    } catch (err) {
      streams.notice(`${OPS_UNAVAILABLE_PREFIX}${errorMessage(err)}`)
    }
  }
  await streams.document(body)
  return ExitCode.Success
}

function namespaceRows(name: string, node: CommandNode): { commands: CommandRow[] } {
  return { commands: treeRows({ [name]: node }) }
}

function unknownCommand(tree: CommandTree, words: readonly string[]): BaseError {
  const suggestions = findSuggestions(tree, [...words])
  return new BaseError({
    code: ErrorCode.UsageInvalidFlag,
    message: `unknown command: ${words.join(' ')}`,
    hint:
      suggestions.length > 0
        ? `did you mean: ${suggestions.join(', ')}`
        : `run ${BINARY} ${HELP_WORD}`,
  })
}

async function noCommand(
  tree: CommandTree,
  words: readonly string[],
  wantsHelp: boolean,
  ctx: CommandContext,
  streams: IOService,
): Promise<number> {
  const head = words[0]
  if (head === undefined) return rootHelp(tree, ctx, streams)

  const node = tree[head]
  if (wantsHelp && node !== undefined && Object.keys(node.subcommands).length > 0) {
    await streams.document(namespaceRows(head, node))
    return ExitCode.Success
  }
  throw unknownCommand(tree, words)
}

// parseArgv only coerces what was typed; zod owns the declared defaults. Reaching here
// means validation already passed, so a zod rejection is a schema/parser contract bug.
function withDefaults(
  Ctor: CommandConstructor,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = Ctor.input.safeParse(input)
  if (!parsed.success) {
    throw new BaseError({
      code: ErrorCode.Unknown,
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      cause: parsed.error,
    })
  }
  return parsed.data
}

export async function runPipeline(tree: CommandTree, ctx: CommandContext): Promise<number> {
  const streams = await ctx.get(io)
  const argv = (await ctx.get(globalFlags)).rest
  const words = argv.filter(isWord)
  const byHelpWord = words[0] === HELP_WORD
  const tokens = byHelpWord ? withoutHelpWord(argv) : argv
  const path = byHelpWord ? words.slice(1) : words
  const wantsHelp =
    argv.length === 0 || byHelpWord || argv.some((token) => HELP_FLAGS.includes(token))

  const resolved = resolveCommand(tree, path)
  if (resolved === undefined) return noCommand(tree, path, wantsHelp, ctx, streams)

  const Ctor = resolved.command
  const rest = restAfterPath(tokens, resolved.path.length)
  if (wantsHelp) {
    await streams.document(await Ctor.help({ path: resolved.path, rest, ctx }))
    return ExitCode.Success
  }

  const schema = inputSchema(Ctor.input)
  const input = parseArgv(rest, { positional: Ctor.positional, schema })
  const details = validateInput(schema, input)
  if (details.length > 0) {
    throw new BaseError({
      code: ErrorCode.InputInvalid,
      message: `invalid input for "${resolved.path.join(' ')}"`,
      details: [...details],
      schema,
    })
  }

  const out = await new Ctor().run(withDefaults(Ctor, input), ctx)
  if (out instanceof Outcome) {
    if (out.body !== undefined) await streams.line(out.body)
    return out.code
  }
  if (out === undefined) return ExitCode.Success
  await streams.line(out)
  return ExitCode.Success
}

export const commands = definePlugin({
  name: 'commands',
  needs: BASE_PLUGINS,
  build: (ctx): CommandsService => ({ run: () => runPipeline(commandTree, ctx) }),
})
