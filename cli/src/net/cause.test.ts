import { expect, it } from 'vite-plus/test'
import { networkCause, networkErrorMessage } from './cause'

const EMPTY_MESSAGE = String()

it('names the deepest cause, Node style', () => {
  const inner = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), {
    code: 'ECONNREFUSED',
  })
  expect(networkCause(new TypeError('fetch failed', { cause: inner }))).toBe(
    'connect ECONNREFUSED 127.0.0.1:9',
  )
})

it('adds the code when the message lacks it, Bun style', () => {
  const err = Object.assign(
    new Error('Unable to connect. Is the computer able to access the url?'),
    {
      code: 'ConnectionRefused',
    },
  )
  expect(networkCause(new Error('outer', { cause: err }))).toBe(
    'ConnectionRefused: Unable to connect. Is the computer able to access the url?',
  )
})

it('returns undefined with no cause or a non-Error cause', () => {
  expect(networkCause(new Error('x'))).toBeUndefined()
  expect(networkCause(new Error('x', { cause: 'text' }))).toBeUndefined()
  expect(networkCause('plain')).toBeUndefined()
  expect(networkCause(undefined)).toBeUndefined()
})

it('ignores a non-string code', () => {
  const err = Object.assign(new Error('boom'), { code: 42 })
  expect(networkCause(new Error('outer', { cause: err }))).toBe('boom')
})

it('stops on a cause chain that loops', () => {
  const a = new Error('a')
  const b = new Error('b', { cause: a })
  Object.assign(a, { cause: b })
  expect(networkCause(new Error('top', { cause: a }))).toBe('a')
})

it('joins the unique sub-error messages of an empty-message AggregateError', () => {
  const err = Object.assign(
    new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:9'),
        new Error('connect ECONNREFUSED 127.0.0.1:9'),
        new Error('connect ECONNREFUSED 127.0.0.1:9'),
      ],
      EMPTY_MESSAGE,
    ),
    { code: 'ECONNREFUSED' },
  )
  expect(networkCause(new TypeError('fetch failed', { cause: err }))).toBe(
    'connect ECONNREFUSED ::1:9; connect ECONNREFUSED 127.0.0.1:9',
  )
})

it('falls back to the code alone, or nothing, when the message is empty', () => {
  const coded = Object.assign(new AggregateError([], EMPTY_MESSAGE), { code: 'ECONNREFUSED' })
  expect(networkCause(new Error('o', { cause: coded }))).toBe('ECONNREFUSED')
  expect(networkCause(new Error('o', { cause: new Error(EMPTY_MESSAGE) }))).toBeUndefined()
})

it('builds the message with no dangling separator', () => {
  expect(
    networkErrorMessage('network error', new Error('o', { cause: new Error(EMPTY_MESSAGE) })),
  ).toBe('network error')
  expect(networkErrorMessage('network error', new Error('o', { cause: new Error('x') }))).toBe(
    'network error: x',
  )
})
