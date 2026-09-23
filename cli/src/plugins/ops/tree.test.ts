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
    'workspace.list': fixtureOp('workspace.list'),
    'workspace.members.invite': fixtureOp('workspace.members.invite'),
  })
  expect(tree.workspace?.subcommands.list?.command?.facets().op).toBe('workspace.list')
  expect(tree.workspace?.subcommands.members?.command).toBeUndefined()
  expect(tree.workspace?.subcommands.members?.subcommands.invite?.command?.facets().op).toBe(
    'workspace.members.invite',
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
  const tree = opsTree({ 'workspace.switch': fixtureOp('workspace.switch') })
  expect(tree.workspace?.subcommands.switch?.command?.hidden).toBe(true)
})

it('spaces a dotted id into the words it is typed as', () => {
  expect(spacedId('console_app.workflow.run')).toBe('console_app workflow run')
})
