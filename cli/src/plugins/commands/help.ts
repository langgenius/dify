import type { CommandRow } from './describe'
import type { CatalogOp } from '@/plugins/catalog'
import { search, searchDoc } from '@/discovery/search'
import { byHead, groupsOf, namespacesOf, under } from '@/discovery/tree'

export const ENTRY_TYPE = { Command: 'command', Op: 'op' } as const
export type EntryType = (typeof ENTRY_TYPE)[keyof typeof ENTRY_TYPE]

const COMMAND_SEP = ' '
const OP_SEP = '.'
const SEARCH_LIMIT = 20

export type HelpEntry = {
  id: string
  summary: string
  type: EntryType
  kind?: string
}

export type HelpListing = { entries: HelpEntry[]; total: number }

export type HelpSources = Readonly<{
  commands: readonly CommandRow[]
  ops?: Readonly<Record<string, CatalogOp>>
}>

export type HelpMap = {
  commands: Record<string, string[]>
  ops?: Record<string, { ops: number; groups: string[] }>
}

function opEntries(sources: HelpSources): HelpEntry[] {
  return Object.entries(sources.ops ?? {}).map(([id, op]) => ({
    id,
    summary: op.summary,
    type: ENTRY_TYPE.Op,
    kind: op.kind,
  }))
}

function commandEntries(sources: HelpSources): HelpEntry[] {
  return sources.commands.map((row) => ({
    id: row.id,
    summary: row.summary,
    type: ENTRY_TYPE.Command,
  }))
}

function byId(a: HelpEntry, b: HelpEntry): number {
  return a.id < b.id ? -1 : 1
}

export function helpMap(sources: HelpSources): HelpMap {
  const map: HelpMap = { commands: {} }
  for (const [head, verbs] of byHead(
    sources.commands.map((row) => row.id),
    COMMAND_SEP,
  ))
    map.commands[head] = [...verbs]
  if (sources.ops === undefined) return map
  map.ops = {}
  for (const [head, rest] of byHead(Object.keys(sources.ops), OP_SEP))
    map.ops[head] = { ops: rest.length, groups: groupsOf(rest, OP_SEP) }
  return map
}

export function isOpId(word: string, sources: HelpSources): boolean {
  return sources.ops !== undefined && word in sources.ops
}

export function helpListing(word: string, sources: HelpSources): HelpListing | undefined {
  const commandIds = sources.commands.map((row) => row.id)
  const opIds = Object.keys(sources.ops ?? {})
  const known =
    namespacesOf(commandIds, COMMAND_SEP).has(word) || namespacesOf(opIds, OP_SEP).has(word)
  if (!known) return undefined
  const wanted = new Set([...under(word, commandIds, COMMAND_SEP), ...under(word, opIds, OP_SEP)])
  const entries = [...commandEntries(sources), ...opEntries(sources)]
    .filter((entry) => wanted.has(entry.id))
    .sort(byId)
  return { entries, total: entries.length }
}

export function helpSearch(words: readonly string[], sources: HelpSources): HelpListing {
  const entries = new Map(
    [...commandEntries(sources), ...opEntries(sources)].map((entry) => [entry.id, entry]),
  )
  const docs = [
    ...sources.commands.map((row) => searchDoc(row.id, row, false)),
    ...Object.entries(sources.ops ?? {}).map(([id, op]) => searchDoc(id, op, op.deprecated)),
  ]
  const result = search(docs, words.join(COMMAND_SEP), { limit: SEARCH_LIMIT })
  return {
    entries: result.hits.flatMap((hit) => {
      const entry = entries.get(hit.id)
      return entry === undefined ? [] : [entry]
    }),
    total: result.total,
  }
}
