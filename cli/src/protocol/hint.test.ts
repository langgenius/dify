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

it('an input that is not an object is dropped, the hint stays', () => {
  expect(
    parseHints([
      { summary: 's', op: 'a.b', input: ['x'] },
      { summary: 's', op: 'a.b', input: 'abc' },
      { summary: 's', op: 'a.b', input: null },
    ]),
  ).toEqual([
    { summary: 's', op: 'a.b' },
    { summary: 's', op: 'a.b' },
    { summary: 's', op: 'a.b' },
  ])
})
