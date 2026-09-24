import { expect, it } from 'vite-plus/test'
import { colorScheme } from '@/sys/io/color'
import { renderEnvelope } from './format'

const plain = colorScheme(false)

it('renders code, message, details, hint, request and status in v1 order', () => {
  const text = renderEnvelope(
    {
      error: {
        code: 'input_invalid',
        message: 'invalid input for "get console_app"',
        details: [{ type: 'maximum', loc: ['limit'], msg: 'must be <= 100' }],
        hint: 'run difyctl help get console_app',
        http_status: 422,
        method: 'GET',
        url: 'https://x/apps',
      },
    },
    plain,
    { verbose: false },
  )
  expect(text.split('\n')).toEqual([
    'input_invalid: invalid input for "get console_app"',
    '  - limit: must be <= 100 (maximum)',
    'hint: run difyctl help get console_app',
    'request: GET https://x/apps',
    'http_status: 422',
  ])
})

it('drops schema in text and shows raw_response only when verbose', () => {
  const env = {
    error: {
      code: 'server_error',
      message: 'boom',
      schema: { type: 'object' },
      raw_response: 'Bearer abc body',
    },
  }
  expect(renderEnvelope(env, plain, { verbose: false })).toBe(
    'server_error: boom\nhint: run again with --verbose to see the raw server response',
  )
  expect(renderEnvelope(env, plain, { verbose: true })).toMatch(/raw_response: Bearer \[redacted\]/)
})
