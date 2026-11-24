import { ORPCError } from '@orpc/client'
import { isTagNameTooLong, isTagNameTooLongError } from '../tag-name-length'

it('accepts 50 trimmed Unicode code points and rejects 51', () => {
  expect(isTagNameTooLong(`  ${'🔖'.repeat(50)}  `)).toBe(false)
  expect(isTagNameTooLong('🔖'.repeat(51))).toBe(true)
})

const issue = { type: 'string_too_long', loc: ['name'] }
const validationError = (message: string) =>
  new ORPCError('unprocessable_entity', { status: 422, message })

it('recognizes the Console validation issue for an overlong tag name', () => {
  expect(isTagNameTooLongError(validationError(JSON.stringify([issue])))).toBe(true)
})

it.each([
  JSON.stringify([{ ...issue, loc: ['type'] }]),
  JSON.stringify([{ ...issue, type: 'missing' }]),
  JSON.stringify([null]),
  'Invalid request',
])('keeps unrelated 422 responses out of the length hint', (message) => {
  expect(isTagNameTooLongError(validationError(message))).toBe(false)
})

it('keeps other failures out of the length hint', () => {
  const message = JSON.stringify([issue])
  expect(isTagNameTooLongError(new ORPCError('bad_request', { status: 400, message }))).toBe(false)
  expect(isTagNameTooLongError(new Error(message))).toBe(false)
})
