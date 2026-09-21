import { expect, it } from 'vite-plus/test'
import { applyPins, loadInput } from './input'

const src = (raw: string | undefined, stdin = '', files: Record<string, string> = {}) => ({
  raw,
  stdin: async () => stdin,
  readFile: async (p: string) => {
    const f = files[p]
    if (f === undefined) throw new Error('ENOENT')
    return f
  },
})

it('parses inline json, @file and @- and defaults to {}', async () => {
  expect(await loadInput(src('{"a":1}'))).toEqual({ a: 1 })
  expect(await loadInput(src('@in.json', '', { 'in.json': '{"b":2}' }))).toEqual({ b: 2 })
  expect(await loadInput(src('@-', '{"c":3}'))).toEqual({ c: 3 })
  expect(await loadInput(src(undefined))).toEqual({})
})

it('rejects non-object json and unreadable files with input_invalid', async () => {
  await expect(loadInput(src('[1]'))).rejects.toMatchObject({ code: 'input_invalid' })
  await expect(loadInput(src('nope'))).rejects.toMatchObject({ code: 'input_invalid' })
  await expect(loadInput(src('@missing.json'))).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('missing.json'),
  })
})

it('fills pins only for declared, absent fields', () => {
  const schema = {
    type: 'object',
    properties: { workspace_id: { type: 'string' }, page: { type: 'integer' } },
  }
  expect(applyPins({ page: 2 }, schema, { workspace_id: 'ws-1' })).toEqual({
    page: 2,
    workspace_id: 'ws-1',
  })
  expect(applyPins({ workspace_id: 'mine' }, schema, { workspace_id: 'ws-1' })).toEqual({
    workspace_id: 'mine',
  })
  expect(
    applyPins({}, { type: 'object', properties: { page: {} } }, { workspace_id: 'ws-1' }),
  ).toEqual({})
  expect(applyPins({}, schema, { workspace_id: null })).toEqual({})
})
