import type { CommandConstructor, CommandEffect } from './command'
import type { CollectOptions, CommandTree } from './registry'
import type { SearchDoc } from '@/discovery/search'
import type { View } from '@/sys/io/view'
import { search, searchDoc } from '@/discovery/search'
import { byHead, groupsOf, namespacesOf, under } from '@/discovery/tree'
import { COMMAND_SEPARATOR, OP_SEPARATOR, spacedId } from '@/protocol/op-id'
import { view } from '@/sys/io/view'
import { BINARY } from '@/version/info'
import { HELP_WORD } from './command'
import { collectCommands } from './registry'

const SEARCH_LIMIT = 20
const NEWLINE = '\n'
const SKILL_WORDS = 'install skills <dir>'
const POINTER_MESSAGE = `${BINARY} has no built-in business commands; every server operation is a command`

export type HelpEntry = {
  id: string
  summary: string
  effect?: CommandEffect
  kind?: string
  deprecated?: boolean
}

export type HelpListing = { entries: HelpEntry[]; total: number }
export type HelpHead = { summary?: string; count: number; groups: string[] }
export type HelpMap = Record<string, HelpHead>

/** Bare `difyctl`: where to look, without a request. */
export function pointer(): View<Record<string, string>> {
  const json = {
    message: POINTER_MESSAGE,
    help: [BINARY, HELP_WORD].join(COMMAND_SEPARATOR),
    skill: [BINARY, SKILL_WORDS].join(COMMAND_SEPARATOR),
  }
  return view(json, () => Object.values(json).join(NEWLINE))
}

/** `help run.console_app.workflow` names the command its spaced words name. */
export function spacedWords(words: readonly string[]): readonly string[] {
  const [only] = words
  if (words.length !== 1 || only === undefined || !only.includes(OP_SEPARATOR)) return words
  return spacedId(only).split(COMMAND_SEPARATOR)
}

function entryOf(ctor: CommandConstructor, id: string): HelpEntry {
  const entry: HelpEntry = { id, summary: ctor.summary }
  if (ctor.effect !== undefined) entry.effect = ctor.effect
  const { deprecated, kind } = ctor.facets()
  if (kind !== undefined) entry.kind = kind
  if (deprecated !== undefined) entry.deprecated = deprecated
  return entry
}

// `schema()` is the documented input, so an adapter is indexed on the op's own fields
// rather than on the parse schema, which carries call options every op would match.
function docOf(ctor: CommandConstructor, id: string): SearchDoc {
  return searchDoc(
    id,
    { summary: ctor.summary, input: ctor.schema(), examples: ctor.examples },
    ctor.facets().deprecated === true,
  )
}

/** Every command the tree lists, static or catalog op, as one flat list. */
export function entriesOf(tree: CommandTree, opts?: CollectOptions): HelpEntry[] {
  return collectCommands(tree, opts).map(({ command, path }) =>
    entryOf(command, path.join(COMMAND_SEPARATOR)),
  )
}

function byId(a: HelpEntry, b: HelpEntry): number {
  return a.id < b.id ? -1 : 1
}

export function helpMap(entries: readonly HelpEntry[]): HelpMap {
  const leaves = new Map(entries.map((entry) => [entry.id, entry]))
  const map: HelpMap = {}
  for (const [head, rest] of byHead(
    entries.map((entry) => entry.id),
    COMMAND_SEPARATOR,
  )) {
    const self = leaves.get(head)
    const count = rest.length + (self === undefined ? 0 : 1)
    map[head] =
      self !== undefined && count === 1
        ? { summary: self.summary, count, groups: [] }
        : { count, groups: groupsOf(rest, COMMAND_SEPARATOR) }
  }
  return map
}

export function helpListing(
  namespace: string,
  entries: readonly HelpEntry[],
): HelpListing | undefined {
  const ids = entries.map((entry) => entry.id)
  if (!namespacesOf(ids, COMMAND_SEPARATOR).has(namespace)) return undefined
  const wanted = new Set(under(namespace, ids, COMMAND_SEPARATOR))
  const found = entries.filter((entry) => wanted.has(entry.id)).sort(byId)
  return { entries: found, total: found.length }
}

// Ranked over everything a command declares — id, summary, field names and descriptions,
// example titles — so the words a task is described in reach the fields that take them.
export function helpSearch(
  words: readonly string[],
  tree: CommandTree,
  opts?: CollectOptions,
): HelpListing {
  const byKey = new Map<string, HelpEntry>()
  const docs: SearchDoc[] = []
  for (const { command, path } of collectCommands(tree, opts)) {
    const id = path.join(COMMAND_SEPARATOR)
    byKey.set(id, entryOf(command, id))
    docs.push(docOf(command, id))
  }
  const result = search(docs, words.join(COMMAND_SEPARATOR), { limit: SEARCH_LIMIT })
  return {
    entries: result.hits.flatMap((hit) => {
      const entry = byKey.get(hit.id)
      return entry === undefined ? [] : [entry]
    }),
    total: result.total,
  }
}
