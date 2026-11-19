import { parseToolDateRangeValue, stringifyToolDateRangeValue } from '../tool-date-range-value'

it('round-trips the tool parameter JSON contract and clears empty ranges', () => {
  const value = { start: '2025-01-15', end: '2025-01-20' }
  expect(parseToolDateRangeValue(value)).toEqual(value)
  expect(parseToolDateRangeValue(stringifyToolDateRangeValue(value))).toEqual(value)
  expect(stringifyToolDateRangeValue({})).toBe('')
})

it('rejects invalid endpoints instead of passing them to the picker', () => {
  expect(parseToolDateRangeValue('{"start":"2025-02-30","end":"2025-03-01"}')).toEqual({
    start: undefined,
    end: '2025-03-01',
  })
})

it.each(['2025-01-15', '2025-01-15T12:00:00Z', '{', 'null'])(
  'does not reinterpret unsupported stored data as a date range: %j',
  (value) => expect(parseToolDateRangeValue(value)).toEqual({}),
)
