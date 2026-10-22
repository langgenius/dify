import { expect, it } from 'vite-plus/test'
import { retryAfterSeconds } from './retry-after'

const NOW_MS = Date.parse('2026-10-22T10:00:00Z')

it('reads delta-seconds', () => {
  expect(retryAfterSeconds('1', NOW_MS)).toBe(1)
  expect(retryAfterSeconds('0', NOW_MS)).toBe(0)
  expect(retryAfterSeconds('120', NOW_MS)).toBe(120)
})

it('turns an HTTP date into seconds from now', () => {
  expect(retryAfterSeconds('Thu, 22 Oct 2026 10:00:30 GMT', NOW_MS)).toBe(30)
  expect(retryAfterSeconds('Thu, 22 Oct 2026 10:00:00 GMT', NOW_MS + 500)).toBe(0)
})

it('rounds a part-second wait up', () => {
  expect(retryAfterSeconds('Thu, 22 Oct 2026 10:00:30 GMT', NOW_MS - 500)).toBe(31)
})

it('clamps a past HTTP date to 0', () => {
  expect(retryAfterSeconds('Thu, 22 Oct 2026 09:00:00 GMT', NOW_MS)).toBe(0)
})

it('omits values it cannot trust', () => {
  for (const bad of [
    '-5',
    '',
    ' ',
    'soon',
    '1.5',
    '1e3',
    '+5',
    '99999999999999999999',
    'Thu, 99 Oct 2026 10:00:30 GMT',
    '2026-10-22T10:00:30Z',
    null,
  ])
    expect(retryAfterSeconds(bad, NOW_MS)).toBeUndefined()
})
