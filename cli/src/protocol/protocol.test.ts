import { expect, it } from 'vite-plus/test'
import { isBind } from './bind'
import { isKind, KINDS } from './kinds'

it('names the frozen protocol', () => {
  expect(KINDS).toEqual(['object', 'list', 'sse', 'text', 'file'])
  expect(isKind('hologram')).toBe(false)
  expect(isBind('header')).toBe(false)
})
