import { expect, it } from 'vite-plus/test'
import { OutputMode, resolveOutput } from './index'

const tty = { isOutTTY: true, isErrTTY: true }
const pipe = { isOutTTY: false, isErrTTY: false }

it('is text on a tty and json in a pipe, per channel', () => {
  expect(resolveOutput({ argv: [], env: {}, streams: tty })).toEqual({
    out: OutputMode.Text,
    err: OutputMode.Text,
  })
  expect(resolveOutput({ argv: [], env: {}, streams: pipe })).toEqual({
    out: OutputMode.Json,
    err: OutputMode.Json,
  })
  expect(
    resolveOutput({ argv: [], env: {}, streams: { isOutTTY: false, isErrTTY: true } }),
  ).toEqual({ out: OutputMode.Json, err: OutputMode.Text })
})

it('--json and DIFY_OUTPUT=json force json on a tty; the flag wins over env', () => {
  expect(resolveOutput({ argv: ['--json'], env: {}, streams: tty }).out).toBe(OutputMode.Json)
  expect(resolveOutput({ argv: [], env: { DIFY_OUTPUT: 'json' }, streams: tty }).out).toBe(
    OutputMode.Json,
  )
  expect(resolveOutput({ argv: ['--json'], env: { DIFY_OUTPUT: 'text' }, streams: pipe }).out).toBe(
    OutputMode.Json,
  )
})

it('an unknown DIFY_OUTPUT value is ignored, not guessed', () => {
  expect(resolveOutput({ argv: [], env: { DIFY_OUTPUT: 'yaml' }, streams: pipe }).out).toBe(
    OutputMode.Json,
  )
  expect(resolveOutput({ argv: [], env: { DIFY_OUTPUT: 'yaml' }, streams: tty }).out).toBe(
    OutputMode.Text,
  )
})

it('--json is only a flag before --, and honors an explicit =value', () => {
  expect(resolveOutput({ argv: ['--', '--json'], env: {}, streams: tty }).out).toBe(OutputMode.Text)
  expect(resolveOutput({ argv: ['--json=false'], env: {}, streams: tty }).out).toBe(OutputMode.Text)
  expect(resolveOutput({ argv: ['--json=true'], env: {}, streams: pipe }).out).toBe(OutputMode.Json)
})
