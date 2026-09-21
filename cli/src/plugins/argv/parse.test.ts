import { expect, it } from 'vite-plus/test'
import { parseArgv } from './parse'

const spec = {
  positional: ['op_id'],
  schema: {
    type: 'object',
    properties: {
      op_id: { type: 'string' },
      input: { type: 'string' },
      stream: { type: 'boolean' },
      only: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer' },
      no_browser: { type: 'boolean' },
    },
  },
}

it('fills positionals, flags, booleans, arrays and numbers by schema type', () => {
  expect(
    parseArgv(
      [
        'a.b',
        '--input',
        '{}',
        '--stream',
        '--only',
        'x',
        '--only=y',
        '--limit',
        '3',
        '--no-browser',
      ],
      spec,
    ),
  ).toEqual({
    op_id: 'a.b',
    input: '{}',
    stream: true,
    only: ['x', 'y'],
    limit: 3,
    no_browser: true,
  })
})

it('rejects unknown flags and extra positionals with exit 2', () => {
  expect(() => parseArgv(['a.b', '--nope'], spec)).toThrow(
    expect.objectContaining({
      code: 'usage_invalid_flag',
      message: expect.stringContaining('--nope'),
    }),
  )
  expect(() => parseArgv(['a.b', 'extra'], spec)).toThrow(
    expect.objectContaining({ code: 'usage_invalid_flag' }),
  )
})

it('leaves a bad number for validation to report', () => {
  expect(parseArgv(['--limit', 'many'], { positional: [], schema: spec.schema })).toEqual({
    limit: 'many',
  })
})

it('an empty number value stays the string it was typed as, never 0', () => {
  const bare = { positional: [], schema: spec.schema }
  expect(parseArgv(['--limit='], bare)).toEqual({ limit: '' })
  expect(parseArgv(['--limit', ''], bare)).toEqual({ limit: '' })
  expect(parseArgv(['--limit', ' '], bare)).toEqual({ limit: ' ' })
})
