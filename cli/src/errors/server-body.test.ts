import { expect, it } from 'vite-plus/test'
import { parseServerErrorBody } from './server-body'

const body = (value: Record<string, unknown>) => parseServerErrorBody(JSON.stringify(value))

it('keeps a string message and hint', () => {
  expect(body({ code: 'forbidden', message: 'no', hint: 'ask an owner' })).toEqual({
    code: 'forbidden',
    message: 'no',
    hint: 'ask an owner',
  })
})

it('drops a hint that is not a string', () => {
  const parsed = body({ code: 'forbidden', message: 'no', hint: { text: 'ask an owner' } })
  expect(parsed).toEqual({ code: 'forbidden', message: 'no' })
  expect(parsed).not.toHaveProperty('hint')
})

it('drops an empty hint', () => {
  expect(body({ code: 'forbidden', message: 'no', hint: '' })).not.toHaveProperty('hint')
})

it('treats an empty message as no message, falling back to error', () => {
  expect(body({ code: 'forbidden', message: '' })).toBeUndefined()
  expect(body({ message: '', error: 'invalid_grant' })).toMatchObject({ message: 'invalid_grant' })
  expect(body({ error: '' })).toBeUndefined()
})

it('ignores bodies that are not an error object', () => {
  expect(parseServerErrorBody('')).toBeUndefined()
  expect(parseServerErrorBody('not json')).toBeUndefined()
  expect(parseServerErrorBody('null')).toBeUndefined()
  expect(body({ code: 7, message: 'no' })).toBeUndefined()
})
