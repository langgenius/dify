import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { parseCatalog } from '@/plugins/catalog'
import { validateInput } from './validate'

const doc = parseCatalog(readFileSync(join(__dirname, '../../test/fixtures/catalog.json')))
const run = doc.ops['console_app.workflow.run']!.input
const list = doc.ops['console_app.list']!.input

it('returns no details for valid input against the real schemas', () => {
  expect(
    validateInput(run, { app_id: 'a', inputs: {}, files: { doc: './r.pdf', pages: ['1.png'] } }),
  ).toEqual([])
  expect(validateInput(list, { workspace_id: 'not-a-uuid', limit: 5 })).toEqual([]) // formats are the server's job
})

it('reports missing required, wrong types and bad enums in the 422 detail shape', () => {
  expect(validateInput(run, { inputs: 'x' })).toContainEqual({
    type: 'required',
    loc: ['app_id'],
    msg: expect.stringContaining('required'),
  })
  expect(validateInput(run, { app_id: 'a', inputs: 'x' })).toContainEqual({
    type: 'type',
    loc: ['inputs'],
    msg: expect.stringContaining('object'),
  })
  expect(validateInput(list, { workspace_id: 'w', mode: 'agent' })).toContainEqual({
    type: 'enum',
    loc: ['mode'],
    msg: expect.stringContaining('allowed'),
  })
})

it('lets unknown keys through to the server', () => {
  expect(validateInput(run, { app_id: 'a', inputs: {}, extra: 1 })).toEqual([])
})
