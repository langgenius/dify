import type { Descriptor } from './describe'
import type { CommandContext } from '@/plugins/base'
import type { CollectOptions, CommandTree, ResolvedCommand } from '@/plugins/commands/registry'
import type { IOService } from '@/plugins/io'
import type { OpsService, TreeOptions } from '@/plugins/ops'
import type { Hint } from '@/protocol/hint'
import { commandTree } from '@/commands/tree'
import { BaseError, isBaseError, notLoggedInMessage } from '@/errors/base'
import { ErrorCode, ExitCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { definePlugin } from '@/kernel/plugin'
import { parseArgv } from '@/plugins/argv/parse'
import { BASE_PLUGINS } from '@/plugins/base'
import { catalog } from '@/plugins/catalog'
import { HELP_WORD, helpHint, Outcome } from '@/plugins/commands/command'
import { hintLine } from '@/plugins/commands/examples'
import {
  entriesOf,
  helpListing,
  helpMap,
  helpSearch,
  pointer,
  spacedWords,
} from '@/plugins/commands/help'
import {
  collectCommands,
  findSuggestions,
  mergeTrees,
  nodeAt,
  resolveCommand,
} from '@/plugins/commands/registry'
import { descriptorsView, descriptorView, listingView, mapView } from '@/plugins/commands/text'
import { globalFlags } from '@/plugins/global-flags'
import { io } from '@/plugins/io'
import { ops, RESERVED_FLAGS } from '@/plugins/ops'
import { session } from '@/plugins/session'
import { COMMAND_SEPARATOR } from '@/protocol/op-id'

export type CommandsService = {
  readonly run: () => Promise<number>
  readonly hintCommands: (hints: readonly Hint[]) => Promise<readonly string[]>
}

const HELP_FLAGS: readonly string[] = ['--help', '-h']
const FULL_FLAG = '--full'
const ALL_FLAG = '--all'
const FLAG_PREFIX = '-'
const NO_SERVER_NOTICE = notLoggedInMessage(helpHint('login'))
const MAYBE_AN_OP = 'may be a server operation; log in to load them'
const OPS_UNAVAILABLE_PREFIX = 'could not list server operations: '
const NO_MATCH_NOTICE = `nothing matched; ${helpHint()} for the map`
const NO_REST: readonly string[] = []
// Resolution walks every op the server publishes; `hidden` keeps the internal ones
// out of listings, not out of the tree.
const EVERY_OP: TreeOptions = { includeInternal: true, fresh: false }
const EVERY_OP_FRESH: TreeOptions = { ...EVERY_OP, fresh: true }

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

function leadingWords(tokens: readonly string[]): number {
  const at = tokens.findIndex((token) => !isWord(token))
  return at === -1 ? tokens.length : at
}

/** What a catalog load gave: the value, or why there is none (`failure` unset when logged out). */
type Fetched<T> = Readonly<{ value: T }> | Readonly<{ value?: undefined; failure?: unknown }>

// An unreachable server must not cost the caller the static half of help.
async function fromOps<T>(
  ctx: CommandContext,
  streams: IOService,
  load: (service: OpsService) => Promise<T>,
): Promise<Fetched<T>> {
  const login = await (await ctx.get(session)).current()
  if (login === null) {
    streams.notice(NO_SERVER_NOTICE)
    return {}
  }
  try {
    return { value: await load(await ctx.get(ops)) }
  } catch (failure) {
    streams.notice(`${OPS_UNAVAILABLE_PREFIX}${errorMessage(failure)}`)
    return { failure }
  }
}

function suggestionHint(tree: CommandTree, words: readonly string[]): string | undefined {
  const suggestions = findSuggestions(tree, [...words])
  return suggestions.length > 0 ? `did you mean: ${suggestions.join(', ')}` : undefined
}

function unknownCommand(words: readonly string[], hint: string): BaseError {
  return new BaseError({
    code: ErrorCode.UsageInvalidFlag,
    message: `unknown command: ${words.join(COMMAND_SEPARATOR)}`,
    hint,
  })
}

/** The error for words no command claimed, given the widest tree resolution got. */
type Miss = (tree: CommandTree, words: readonly string[]) => BaseError

const unresolved: Miss = (tree, words) =>
  unknownCommand(words, suggestionHint(tree, words) ?? helpHint())

// A near miss of a static command is a typo (exit 2) whether or not ops could load.
function unlessStaticTypo(statics: CommandTree, miss: Miss): Miss {
  return (tree, words) => {
    const typo = suggestionHint(statics, words)
    return typo === undefined ? miss(tree, words) : unknownCommand(words, typo)
  }
}

const loggedOut: Miss = (_tree, words) =>
  new BaseError({
    code: ErrorCode.NotLoggedIn,
    message: notLoggedInMessage(`${words.join(COMMAND_SEPARATOR)} ${MAYBE_AN_OP}`),
    hint: helpHint('login'),
  })

const unknownOp: Miss = (tree, words) =>
  new BaseError({
    code: ErrorCode.UnknownOp,
    message: `no command or server operation named ${words.join(COMMAND_SEPARATOR)}`,
    hint: suggestionHint(tree, words) ?? helpHint(),
  })

function catalogUnavailable(failure: unknown): BaseError {
  return isBaseError(failure)
    ? failure
    : new BaseError({
        code: ErrorCode.CatalogUnavailable,
        message: `${OPS_UNAVAILABLE_PREFIX}${errorMessage(failure)}`,
        cause: failure,
      })
}

// Words that might name an op cannot be called unknown when the ops never loaded.
function unloaded(statics: CommandTree, fetched: Fetched<unknown>): Miss | undefined {
  if (!('failure' in fetched)) return undefined
  return unlessStaticTypo(statics, () => catalogUnavailable(fetched.failure))
}

type Discovery = Readonly<{
  tree: CommandTree
  path: readonly string[]
  full: boolean
  listing: CollectOptions
  wantsHelp: boolean
  miss: Miss
  ctx: CommandContext
  streams: IOService
}>

// Words no command claimed: the map, a namespace listing, a search — or, when help
// was not asked for, the error that names the miss.
async function discover(args: Discovery): Promise<number> {
  const { ctx, listing, path, streams, tree } = args
  if (path.length === 0 && args.full) {
    // One at a time: a descriptor may read the session, and that file takes a lock.
    const rows: Descriptor[] = []
    for (const found of collectCommands(tree, listing))
      rows.push(await found.command.help({ path: found.path, rest: NO_REST, ctx }))
    await streams.document(descriptorsView(rows))
    return ExitCode.Success
  }

  const entries = entriesOf(tree, listing)
  if (path.length === 0) {
    await streams.document(mapView(helpMap(entries)))
    return ExitCode.Success
  }

  const under = helpListing(path.join(COMMAND_SEPARATOR), entries)
  if (under !== undefined) {
    await streams.document(listingView(under))
    return ExitCode.Success
  }
  if (!args.wantsHelp) throw args.miss(tree, path)

  const found = helpSearch(path, tree, listing)
  if (found.total === 0) streams.notice(NO_MATCH_NOTICE)
  await streams.document(listingView(found))
  return ExitCode.Success
}

type Resolution = {
  readonly resolved: ResolvedCommand | undefined
  readonly tree: CommandTree
  /** Set only when a miss has a better explanation than an unknown command. */
  readonly miss?: Miss
}

type Walk = Readonly<{
  tree: CommandTree
  path: readonly string[]
  wantsHelp: boolean
  ctx: CommandContext
  streams: IOService
}>

// The refetch exists for one case: a path the cached tree does not know at all may name
// an op the server added since. A known group, the bare map and every help view are
// answered from the cache, so they cost one request.
function answerable(walk: Walk, cached: CommandTree): boolean {
  return walk.wantsHelp || walk.path.length === 0 || nodeAt(cached, walk.path) !== undefined
}

// Statics resolve without touching the catalog. A miss walks the server's ops as
// commands too: the cached catalog first, then one refetch in case the op is newer
// than the cache. A server that cannot answer costs help nothing but a notice —
// resolution falls back to the widest tree it did get, which is also the tree help
// lists, so the catalog is loaded at most once per run. A plain miss then reports the
// failed load rather than an unknown command.
async function resolveWithOps(walk: Walk): Promise<Resolution> {
  const { ctx, streams, tree } = walk
  const path = [...walk.path]
  const direct = resolveCommand(tree, path)
  if (direct !== undefined) return { resolved: direct, tree }

  // A help view explains a missing catalog on stderr; a plain miss says to log in.
  if (!walk.wantsHelp && (await (await ctx.get(session)).current()) === null)
    return { resolved: undefined, tree, miss: unlessStaticTypo(tree, loggedOut) }

  const known = await fromOps(ctx, streams, (service) => service.commands(EVERY_OP))
  if (known.value === undefined) return { resolved: undefined, tree, miss: unloaded(tree, known) }
  const cached = mergeTrees(tree, known.value).tree
  const fromCache = resolveCommand(cached, path)
  if (fromCache !== undefined || answerable(walk, cached))
    return { resolved: fromCache, tree: cached }

  const refetched = await fromOps(ctx, streams, (service) => service.commands(EVERY_OP_FRESH))
  if (refetched.value === undefined)
    return { resolved: undefined, tree: cached, miss: unloaded(tree, refetched) }
  const fresh = mergeTrees(tree, refetched.value).tree
  return {
    resolved: resolveCommand(fresh, path),
    tree: fresh,
    miss: unlessStaticTypo(tree, unknownOp),
  }
}

export async function runPipeline(tree: CommandTree, ctx: CommandContext): Promise<number> {
  const streams = await ctx.get(io)
  const argv = (await ctx.get(globalFlags)).rest
  if (argv.length === 0) {
    await streams.document(pointer())
    return ExitCode.Success
  }

  const words = argv.filter(isWord)
  const byHelpWord = words[0] === HELP_WORD
  const tokens = byHelpWord ? withoutHelpWord(argv) : argv
  const path = byHelpWord ? spacedWords(words.slice(1)) : words
  const wantsHelp =
    words.length === 0 || byHelpWord || argv.some((token) => HELP_FLAGS.includes(token))
  const walked = await resolveWithOps({ tree, path, wantsHelp, ctx, streams })
  const resolved = walked.resolved
  const rest = resolved === undefined ? [] : restAfterPath(tokens, resolved.path.length)
  if (
    resolved === undefined ||
    (wantsHelp && leadingWords(rest) > resolved.command.positional.length)
  )
    return discover({
      tree: walked.tree,
      path,
      full: argv.includes(FULL_FLAG),
      listing: { includeHidden: argv.includes(ALL_FLAG) },
      wantsHelp,
      miss: walked.miss ?? unresolved,
      ctx,
      streams,
    })

  const Ctor = resolved.command
  if (wantsHelp) {
    await streams.document(descriptorView(await Ctor.help({ path: resolved.path, rest, ctx })))
    return ExitCode.Success
  }

  const input = parseArgv(rest, { positional: Ctor.positional, schema: Ctor.flags() })
  const out = await new Ctor().run(Ctor.finalize(input, resolved.path), ctx)
  if (out instanceof Outcome) {
    if (out.body !== undefined) await streams.document(out.body)
    return out.code
  }
  if (out === undefined) return ExitCode.Success
  await streams.document(out)
  return ExitCode.Success
}

export const commands = definePlugin({
  name: 'commands',
  needs: BASE_PLUGINS,
  build: (ctx): CommandsService => ({
    run: () => runPipeline(commandTree, ctx),
    hintCommands: async (hints) => {
      const catalogService = await ctx.get(catalog)
      return hints.map((hint) => hintLine(hint, catalogService.op(hint.op), RESERVED_FLAGS))
    },
  }),
})
