import type { CommandTree } from './registry'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { commandTree } from '@/commands/tree'
import { parseCatalog } from '@/plugins/catalog'
import { opsTree } from '@/plugins/ops/tree'
import { colorScheme } from '@/sys/io/color'
import { entriesOf, helpListing, helpMap, helpSearch, pointer, spacedWords } from './help'
import { mergeTrees } from './registry'

const OPS = parseCatalog(readFileSync(join(__dirname, '../../../test/fixtures/catalog.json'))).ops
const tree: CommandTree = mergeTrees(commandTree, opsTree(OPS)).tree
const entries = entriesOf(tree)
const ids = entries.map((entry) => entry.id)
const plain = colorScheme(false)

it('entries are one list of statics and ops, hidden commands left out', () => {
  expect(ids).toContain('use workspace')
  expect(ids).toContain('run console_app workflow')
  expect(ids).not.toContain('switch workspace') // internal
  expect(entries.find((entry) => entry.id === 'run console_app chat')).toEqual({
    id: 'run console_app chat',
    summary: 'Run a chat or agent app; streams message events',
    effect: 'write',
    kind: 'sse',
    deprecated: false,
  })
  expect(entries.find((entry) => entry.id === 'version')).toEqual({
    id: 'version',
    summary: expect.any(String),
    effect: 'read',
  })
})

it('the map is one tree: leaves carry a summary, groups a count and sub-groups', () => {
  const map = helpMap(entries)
  expect(map.login).toMatchObject({ summary: expect.any(String), count: 1, groups: [] })
  expect(map.run).toMatchObject({
    count: expect.any(Number),
    groups: expect.arrayContaining(['console_app']),
  })
  expect(map.run?.summary).toBeUndefined()
  expect(map.list?.groups).toEqual(expect.arrayContaining(['workspace']))
  expect(map.list?.count).toBe(ids.filter((id) => id.startsWith('list ')).length)
  expect(map.call).toBeUndefined()
  expect(map.ops).toBeUndefined()
})

it('a listing works on a namespace of any depth and nowhere else', () => {
  expect(helpListing('run console_app', entries)?.entries.map((entry) => entry.id)).toEqual([
    'run console_app advanced_chat',
    'run console_app chat',
    'run console_app completion',
    'run console_app workflow',
  ])
  const exports = helpListing('export', entries)
  expect(exports?.entries.map((entry) => entry.id)).toContain('export console_app dsl')
  expect(exports?.total).toBe(exports?.entries.length)
  expect(helpListing('version', entries)).toBeUndefined() // a leaf is not a namespace
  expect(helpListing('zebra', entries)).toBeUndefined()
})

it('every command the tree hides comes back with includeHidden', () => {
  const all = entriesOf(tree, { includeHidden: true }).map((entry) => entry.id)
  expect(all).toContain('switch workspace') // internal op
  expect(all).toContain('use workspace') // and everything the default already listed
})

it('search ranks the plain words against ids, summaries, fields and examples', () => {
  expect(helpSearch(['chatbot'], tree).entries[0]).toMatchObject({
    id: 'run console_app chat',
    kind: 'sse',
  })
  // `attachments` is a field name only: it appears in no id, summary or example title.
  const byField = helpSearch(['attachments'], tree).entries.map((entry) => entry.id)
  expect(byField).toContain('run console_app workflow')
  expect(helpSearch(['zebra'], tree)).toEqual({ entries: [], total: 0 })
  expect(helpSearch(['switch'], tree).entries.map((entry) => entry.id)).not.toContain(
    'switch workspace',
  )
  expect(
    helpSearch(['switch'], tree, { includeHidden: true }).entries.map((entry) => entry.id),
  ).toContain('switch workspace')
})

it('a single dotted word is the spaced path typed as one word', () => {
  expect(spacedWords(['run.console_app.workflow'])).toEqual(['run', 'console_app', 'workflow'])
  expect(spacedWords(['list', 'console_app'])).toEqual(['list', 'console_app'])
  expect(spacedWords(['upload.file', 'now'])).toEqual(['upload.file', 'now'])
  expect(spacedWords([])).toEqual([])
})

it('the pointer names help and the skill in both forms', () => {
  const pointed = pointer()
  expect(pointed.json).toEqual({
    message: 'difyctl has no built-in business commands; every server operation is a command',
    help: 'difyctl help',
    skill: 'difyctl install skills <dir>',
  })
  expect(pointed.text(plain).split('\n')).toEqual(Object.values(pointed.json))
})
