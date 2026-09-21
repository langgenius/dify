import { expect, it } from 'vite-plus/test'
import { bufferStreams } from '@/sys/io/streams'
import { BaseError, HttpClientError } from './base'
import { ErrorCode } from './codes'
import { printEnvelope } from './envelope'

it('prints one JSON line with details and schema and returns the exit code', () => {
  const io = bufferStreams()
  const code = printEnvelope(
    new BaseError({
      code: ErrorCode.InputInvalid,
      message: 'bad',
      details: [{ type: 'required', loc: ['inputs'], msg: 'missing' }],
      schema: { type: 'object' },
    }),
    io,
    { verbose: false },
  )
  expect(code).toBe(2)
  expect(JSON.parse(io.errBuf())).toEqual({
    error: {
      code: 'input_invalid',
      message: 'bad',
      details: [{ type: 'required', loc: ['inputs'], msg: 'missing' }],
      schema: { type: 'object' },
    },
  })
})

it('hides raw_response unless verbose and redacts the bearer', () => {
  const err = new HttpClientError({
    code: ErrorCode.ServerError,
    message: 'x',
    httpStatus: 500,
    rawResponse: 'Bearer abc',
  })
  const quiet = bufferStreams()
  printEnvelope(err, quiet, { verbose: false })
  expect(JSON.parse(quiet.errBuf()).error.raw_response).toBeUndefined()
  const loud = bufferStreams()
  printEnvelope(err, loud, { verbose: true })
  expect(JSON.parse(loud.errBuf()).error.raw_response).toBe('Bearer [redacted]')
})

it('wraps unknown errors as unknown with exit 1', () => {
  const io = bufferStreams()
  expect(printEnvelope(new Error('boom'), io, { verbose: false })).toBe(1)
  expect(JSON.parse(io.errBuf()).error.code).toBe('unknown')
})
