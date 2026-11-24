import { expect, it } from 'vite-plus/test'
import { parseHints } from './hint'

it('keeps only hints with a string op and summary', () => {
  const good = { op: 'get.app', summary: 'list apps', input: {} }
  expect(parseHints([good, { summary: 'no op' }, { op: 1, summary: 'x' }, 'text', null])).toEqual([
    good,
  ])
})

it.each([undefined, null, 'hints', { op: 'get.app', summary: 'x' }])(
  'reads %j as no hints',
  (value) => {
    expect(parseHints(value)).toEqual([])
  },
)
