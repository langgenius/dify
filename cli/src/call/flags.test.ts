import { expect, it } from 'vite-plus/test'
import { unsupportedFlags } from './flags'

it('refuses the flags a kind does not accept and treats an unknown kind as an object', () => {
  const all = { input: '{}', stream: true, only: ['a'], output: 'f' }
  expect(unsupportedFlags('sse', all)).toEqual(['output'])
  expect(unsupportedFlags('file', all)).toEqual(['stream', 'only'])
  expect(unsupportedFlags('hologram', { stream: true })).toEqual(['stream'])
  expect(unsupportedFlags('object', { input: '{}' })).toEqual([])
})
