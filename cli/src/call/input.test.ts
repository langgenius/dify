import { expect, it } from 'vite-plus/test'
import { applyPins, loadInput, resolveFileRefs } from './input'

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

const REF_SCHEMA = {
  type: 'object',
  properties: {
    inputs: { type: 'object', properties: {} },
    files: { type: 'array', items: { type: 'object', properties: {} } },
    query: { type: 'string' },
  },
}

const refs = (stdin: string, files: Record<string, string> = {}) => ({
  stdin: async () => stdin,
  readFile: async (p: string) => {
    const f = files[p]
    if (f === undefined) throw new Error('ENOENT')
    return f
  },
})

it('resolves @file and @- only on non-scalar declared fields', async () => {
  expect(
    await resolveFileRefs(
      { inputs: '@in.json', files: '@-', query: '@keep', other: '@untouched' },
      REF_SCHEMA,
      refs('[{"b":2}]', { 'in.json': '{"a":1}' }),
    ),
  ).toEqual({ inputs: { a: 1 }, files: [{ b: 2 }], query: '@keep', other: '@untouched' })
})

it('an array field takes an array from its file', async () => {
  expect(
    await resolveFileRefs(
      { files: '@files.json' },
      REF_SCHEMA,
      refs('', { 'files.json': '[{"c":3}]' }),
    ),
  ).toEqual({ files: [{ c: 3 }] })
})

it('reports an unreadable reference as input_invalid', async () => {
  await expect(
    resolveFileRefs({ inputs: '@missing.json' }, REF_SCHEMA, refs('')),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('missing.json'),
  })
})

it('names the field flag when a reference is not valid JSON', async () => {
  await expect(
    resolveFileRefs({ files: '@files.json' }, REF_SCHEMA, refs('', { 'files.json': 'nope' })),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('--files'),
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
