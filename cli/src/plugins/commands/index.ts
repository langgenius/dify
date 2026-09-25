import type { Descriptor } from './describe'
import type { CommandContext } from '@/plugins/base'
import type { CollectOptions, CommandTree, ResolvedCommand } from '@/plugins/commands/registry'
import type { IOService } from '@/plugins/io'
import type { OpsService, TreeOptions } from '@/plugins/ops'
import { commandTree } from '@/commands/tree'
import { BaseError } from '@/errors/base'
import { ErrorCode, ExitCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { definePlugin } from '@/kernel/plugin'
import { parseArgv } from '@/plugins/argv/parse'
import { BASE_PLUGINS } from '@/plugins/base'
import { HELP_WORD, helpHint, Outcome } from '@/plugins/commands/command'
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
import { ops } from '@/plugins/ops'
import { session } from '@/plugins/session'
import { COMMAND_SEPARATOR } from '@/protocol/op-id'

export type CommandsService = {
  readonly run: () => Promise<number>
}

const HELP_FLAGS: readonly string[] = ['--help', '-h']
const FULL_FLAG = '--full'
const ALL_FLAG = '--all'
const FLAG_PREFIX = '-'
const NO_SERVER_NOTICE = 'log in to list server operations'
const NO_SERVER_HINT = 'log in to use server operations'
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

// An unreachable server must not cost the caller the static half of help.
async function fromOps<T>(
  ctx: CommandContext,
  streams: IOService,
  load: (service: OpsService) => Promise<T>,
): Promise<T | undefined> {
  const login = await (await ctx.get(session)).current()
  if (login === null) {
    streams.notice(NO_SERVER_NOTICE)
    return undefined
  }
  try {
    return await load(await ctx.get(ops))
  } catch (err) {
    streams.notice(`${OPS_UNAVAILABLE_PREFIX}${errorMessage(err)}`)
    return undefined
  }
}

function unknownCommand(tree: CommandTree, words: readonly string[], fallback: string): BaseError {
  const suggestions = findSuggestions(tree, [...words])
  return new BaseError({
    code: ErrorCode.UsageInvalidFlag,
    message: `unknown command: ${words.join(COMMAND_SEPARATOR)}`,
    hint: suggestions.length > 0 ? `did you mean: ${suggestions.join(', ')}` : fallback,
  })
}

type Discovery = Readonly<{
  tree: CommandTree
  path: readonly string[]
  full: boolean
  listing: CollectOptions
  wantsHelp: boolean
  missHint?: string
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
  if (!args.wantsHelp) throw unknownCommand(tree, path, args.missHint ?? helpHint())

  const found = helpSearch(path, tree, listing)
  if (found.total === 0) streams.notice(NO_MATCH_NOTICE)
  await streams.document(listingView(found))
  return ExitCode.Success
}

type Resolution = {
  readonly resolved: ResolvedCommand | undefined
  readonly tree: CommandTree
  /** Set only when a miss has a better explanation than the generic help hint. */
  readonly missHint?: string
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
// than the cache. A server that cannot answer costs the caller nothing but a notice —
// resolution falls back to the widest tree it did get, which is also the tree help
// lists, so the catalog is loaded at most once per run.
async function resolveWithOps(walk: Walk): Promise<Resolution> {
  const { ctx, streams, tree } = walk
  const path = [...walk.path]
  const direct = resolveCommand(tree, path)
  if (direct !== undefined) return { resolved: direct, tree }

  // A help view explains a missing catalog on stderr; a plain miss gets the hint instead.
  if (!walk.wantsHelp && (await (await ctx.get(session)).current()) === null)
    return { resolved: undefined, tree, missHint: NO_SERVER_HINT }

  const known = await fromOps(ctx, streams, (service) => service.commands(EVERY_OP))
  if (known === undefined) return { resolved: undefined, tree }
  const cached = mergeTrees(tree, known).tree
  const fromCache = resolveCommand(cached, path)
  if (fromCache !== undefined || answerable(walk, cached))
    return { resolved: fromCache, tree: cached }

  const refetched = await fromOps(ctx, streams, (service) => service.commands(EVERY_OP_FRESH))
  if (refetched === undefined) return { resolved: undefined, tree: cached }
  const fresh = mergeTrees(tree, refetched).tree
  return { resolved: resolveCommand(fresh, path), tree: fresh }
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
  if (resolved === undefined)
    return discover({
      tree: walked.tree,
      path,
      full: argv.includes(FULL_FLAG),
      listing: { includeHidden: argv.includes(ALL_FLAG) },
      wantsHelp,
      missHint: walked.missHint,
      ctx,
      streams,
    })

  const Ctor = resolved.command
  const rest = restAfterPath(tokens, resolved.path.length)
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
  build: (ctx): CommandsService => ({ run: () => runPipeline(commandTree, ctx) }),
})
