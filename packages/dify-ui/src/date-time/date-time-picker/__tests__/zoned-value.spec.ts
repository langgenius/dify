import { getPossibleInstants, resolveZonedWallTime } from '../zoned-value'

describe('zoned date-time resolution', () => {
  it('rejects a wall time skipped by daylight saving', () => {
    expect(getPossibleInstants({ date: '2024-03-10', time: '02:30' }, 'America/New_York')).toEqual(
      [],
    )
  })

  it('preserves a previously selected instant during a repeated wall time', () => {
    const wall = { date: '2024-11-03', time: '01:30' }
    const candidates = getPossibleInstants(wall, 'America/New_York')
    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.toISOString()).toBe('2024-11-03T05:30:00.000Z')
    expect(candidates[1]?.toISOString()).toBe('2024-11-03T06:30:00.000Z')
    expect(resolveZonedWallTime(wall, 'America/New_York', candidates[1])).toEqual(candidates[1])
  })
})

it('preserves sub-minute precision for an unchanged repeated wall time', () => {
  const original = new Date('2024-11-03T06:30:42.123Z')
  expect(
    resolveZonedWallTime({ date: '2024-11-03', time: '01:30' }, 'America/New_York', original),
  ).toEqual(original)
})
