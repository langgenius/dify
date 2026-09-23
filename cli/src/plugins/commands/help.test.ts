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
  expect(ids).toContain('workspace use')
  expect(ids).toContain('console_app workflow run')
  expect(ids).not.toContain('workspace switch') // internal
  expect(entries.find((entry) => entry.id === 'console_app chat run')).toEqual({
    id: 'console_app chat run',
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
  expect(map.console_app).toMatchObject({
    count: expect.any(Number),
    groups: expect.arrayContaining(['chat', 'dsl']),
  })
  expect(map.console_app?.summary).toBeUndefined()
  expect(map.workspace?.groups).toEqual(expect.arrayContaining(['members']))
  expect(map.workspace?.count).toBe(
    ids.filter((id) => id === 'workspace' || id.startsWith('workspace ')).length,
  )
  expect(map.call).toBeUndefined()
  expect(map.ops).toBeUndefined()
})

it('a listing works on a namespace of any depth and nowhere else', () => {
  expect(helpListing('workspace members', entries)?.entries.map((entry) => entry.id)).toEqual([
    'workspace members invite',
    'workspace members list',
    'workspace members remove',
    'workspace members set_role',
  ])
  const consoleApp = helpListing('console_app', entries)
  expect(consoleApp?.entries.map((entry) => entry.id)).toContain('console_app dsl export')
  expect(consoleApp?.total).toBe(consoleApp?.entries.length)
  expect(helpListing('version', entries)).toBeUndefined() // a leaf is not a namespace
  expect(helpListing('zebra', entries)).toBeUndefined()
})

it('every command the tree hides comes back with includeHidden', () => {
  const all = entriesOf(tree, { includeHidden: true }).map((entry) => entry.id)
  expect(all).toContain('workspace switch') // internal op
  expect(all).toContain('workspace use') // and everything the default already listed
})

it('search ranks the plain words against ids, summaries, fields and examples', () => {
  expect(helpSearch(['chatbot'], tree).entries[0]).toMatchObject({
    id: 'console_app chat run',
    kind: 'sse',
  })
  // `attachments` is a field name only: it appears in no id, summary or example title.
  const byField = helpSearch(['attachments'], tree).entries.map((entry) => entry.id)
  expect(byField).toContain('console_app workflow run')
  expect(helpSearch(['zebra'], tree)).toEqual({ entries: [], total: 0 })
  expect(helpSearch(['switch'], tree).entries.map((entry) => entry.id)).not.toContain(
    'workspace switch',
  )
  expect(
    helpSearch(['switch'], tree, { includeHidden: true }).entries.map((entry) => entry.id),
  ).toContain('workspace switch')
})

it('a single dotted word is the spaced path typed as one word', () => {
  expect(spacedWords(['console_app.workflow.run'])).toEqual(['console_app', 'workflow', 'run'])
  expect(spacedWords(['console_app', 'list'])).toEqual(['console_app', 'list'])
  expect(spacedWords(['upload.file', 'now'])).toEqual(['upload.file', 'now'])
  expect(spacedWords([])).toEqual([])
})

it('the pointer names help and the skill in both forms', () => {
  const pointed = pointer()
  expect(pointed.json).toEqual({
    message: 'difyctl has no built-in business commands; every server operation is a command',
    help: 'difyctl help',
    skill: 'difyctl skills install <dir>',
  })
  expect(pointed.text(plain).split('\n')).toEqual(Object.values(pointed.json))
})
