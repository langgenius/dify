import type { CatalogOp } from '@/plugins/catalog'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { commandTree } from '@/commands/tree'
import { parseCatalog } from '@/plugins/catalog'
import { mergeTrees } from '@/plugins/commands/registry'
import { spacedId } from '@/protocol/op-id'
import { opsTree } from './tree'

const OPS = parseCatalog(readFileSync(join(__dirname, '../../../test/fixtures/catalog.json'))).ops

function fixtureOp(id: string): CatalogOp {
  const op = OPS[id]
  if (op === undefined) throw new Error(`the catalog fixture has no op ${id}`)
  return op
}

it('builds a tree from dotted ids, one command per leaf', () => {
  const tree = opsTree({
    'list.workspace': fixtureOp('list.workspace'),
    'invite.workspace.member': fixtureOp('invite.workspace.member'),
  })
  expect(tree.list?.subcommands.workspace?.command?.facets().op).toBe('list.workspace')
  expect(tree.invite?.subcommands.workspace?.command).toBeUndefined()
  expect(tree.invite?.subcommands.workspace?.subcommands.member?.command?.facets().op).toBe(
    'invite.workspace.member',
  )
})

// Collisions are silent at run time — the static wins and the op is only reachable by id —
// so the published catalog is checked against the real command tree here.
it('no op the catalog publishes is shadowed by a static command', () => {
  const published = parseCatalog(
    readFileSync(join(__dirname, '../../../test/fixtures/catalog-v2.json')),
  ).ops
  expect(mergeTrees(commandTree, opsTree(published)).shadowed).toEqual([])
})

it('an internal op is in the tree but stays out of listings', () => {
  const tree = opsTree({ 'switch.workspace': fixtureOp('switch.workspace') })
  expect(tree.switch?.subcommands.workspace?.command?.hidden).toBe(true)
})

it('spaces a dotted id into the words it is typed as', () => {
  expect(spacedId('run.console_app.workflow')).toBe('run console_app workflow')
})
