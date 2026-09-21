import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { parseCatalog } from './types'

const FIXTURE = readFileSync(join(__dirname, '../../../test/fixtures/catalog.json'))

it('parses the real catalog and defaults examples to []', () => {
  const doc = parseCatalog(FIXTURE)
  expect(Object.keys(doc.ops).length).toBeGreaterThan(20)
  expect(doc.ops['console_app.workflow.run']?.kind).toBe('sse')
  expect(doc.ops['console_app.workflow.run']?.examples).toEqual([])
  expect(doc.ops['console_app.run']?.deprecated).toBe(true)
  expect(doc.ops['workspace.switch']?.internal).toBe(true)
})

it('accepts kinds and binds it has never heard of', () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      ops: {
        'x.y': {
          summary: '',
          method: 'GET',
          path: '/x',
          kind: 'hologram',
          input: { type: 'object' },
          bind: { a: 'header' },
          tags: [],
          internal: false,
          deprecated: false,
        },
      },
    }),
  )
  expect(parseCatalog(bytes).ops['x.y']?.kind).toBe('hologram')
})

it('rejects a document without ops as catalog_unavailable', () => {
  expect(() => parseCatalog(new TextEncoder().encode('{"nope":1}'))).toThrow(
    expect.objectContaining({ code: 'catalog_unavailable' }),
  )
})
