import { expect, it } from 'vite-plus/test'
import { ioService } from '@/plugins/io'
import { OutputMode } from '@/plugins/output'
import { bufferStreams } from '@/sys/io/streams'
import { BaseError, HttpClientError } from './base'
import { ErrorCode } from './codes'
import { printEnvelope } from './envelope'

it('prints one JSON line with details and schema and returns the exit code', async () => {
  const streams = bufferStreams()
  const code = await printEnvelope(
    new BaseError({
      code: ErrorCode.InputInvalid,
      message: 'bad',
      details: [{ type: 'required', loc: ['inputs'], msg: 'missing' }],
      schema: { type: 'object' },
    }),
    ioService(streams, { out: OutputMode.Json, err: OutputMode.Json }),
    { verbose: false },
  )
  expect(code).toBe(2)
  expect(JSON.parse(streams.errBuf())).toEqual({
    error: {
      code: 'input_invalid',
      message: 'bad',
      details: [{ type: 'required', loc: ['inputs'], msg: 'missing' }],
      schema: { type: 'object' },
    },
  })
})

it('hides raw_response unless verbose and redacts the bearer', async () => {
  const err = new HttpClientError({
    code: ErrorCode.ServerError,
    message: 'x',
    httpStatus: 500,
    rawResponse: 'Bearer abc',
  })
  const quiet = bufferStreams()
  await printEnvelope(err, ioService(quiet, { out: OutputMode.Json, err: OutputMode.Json }), {
    verbose: false,
  })
  expect(JSON.parse(quiet.errBuf()).error.raw_response).toBeUndefined()
  const loud = bufferStreams()
  await printEnvelope(err, ioService(loud, { out: OutputMode.Json, err: OutputMode.Json }), {
    verbose: true,
  })
  expect(JSON.parse(loud.errBuf()).error.raw_response).toBe('Bearer [redacted]')
})

it('offers --verbose in text when the raw response is hidden, and shows it redacted when asked', async () => {
  const err = new HttpClientError({
    code: ErrorCode.ServerError,
    message: 'boom',
    httpStatus: 500,
    rawResponse: 'Bearer abc body',
  })
  const quiet = bufferStreams()
  await printEnvelope(err, ioService(quiet, { out: OutputMode.Json, err: OutputMode.Text }), {
    verbose: false,
  })
  expect(quiet.errBuf()).toContain('hint: run again with --verbose to see the raw server response')
  expect(quiet.errBuf()).not.toContain('raw_response:')

  const loud = bufferStreams()
  await printEnvelope(err, ioService(loud, { out: OutputMode.Json, err: OutputMode.Text }), {
    verbose: true,
  })
  expect(loud.errBuf()).toContain('raw_response: Bearer [redacted] body')
  expect(loud.errBuf()).not.toContain('--verbose to see')
})

it('wraps unknown errors as unknown with exit 1', async () => {
  const streams = bufferStreams()
  const code = await printEnvelope(
    new Error('boom'),
    ioService(streams, { out: OutputMode.Json, err: OutputMode.Json }),
    { verbose: false },
  )
  expect(code).toBe(1)
  expect(JSON.parse(streams.errBuf()).error.code).toBe('unknown')
})

it('renders the text form on stderr when the err channel is text, exit code unchanged', async () => {
  const streams = bufferStreams()
  const code = await printEnvelope(
    new BaseError({ code: ErrorCode.InputInvalid, message: 'bad' }),
    ioService(streams, { out: OutputMode.Json, err: OutputMode.Text }),
    { verbose: false },
  )
  expect(code).toBe(2)
  expect(streams.errBuf()).toBe('input_invalid: bad\n')
})
