import { formatDateValue, parseDateValue } from '../date-value'

it.each(['2025-02-30', '2025-02', '2025-2-03', '2025-02-03T00:00:00Z', '0000-01-01'])(
  'rejects noncanonical or impossible civil dates: %s',
  (value) => {
    expect(parseDateValue(value)).toBeNull()
  },
)

it.each(['2024-02-29', '2025-02-28', '0099-01-01'])(
  'roundtrips valid civil dates without native Date year coercion: %s',
  (value) => {
    expect(formatDateValue(parseDateValue(value)!)).toBe(value)
  },
)
