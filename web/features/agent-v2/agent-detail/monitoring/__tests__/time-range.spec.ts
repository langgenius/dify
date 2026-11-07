import dayjs from 'dayjs'
import { buildPeriod, getRangeSelection, toPeriodQuery } from '../time-range'

describe('agent monitoring period query', () => {
  it('should end the query at the midnight after the selected end date', () => {
    const query = toPeriodQuery(dayjs('2026-11-06'), dayjs('2026-11-07'))

    expect(query).toEqual({
      start: '2026-11-06 00:00',
      end: '2026-11-08 00:00',
    })
  })

  it('should keep a single selected day inside the half-open range', () => {
    const query = toPeriodQuery(dayjs('2026-11-07'), dayjs('2026-11-07'))

    expect(query.start).toBe('2026-11-07 00:00')
    expect(query.end).toBe('2026-11-08 00:00')
    expect(dayjs(query.end).diff(dayjs(query.start), 'hour')).toBe(24)
  })

  it('should not drop the last minute of the selected end date', () => {
    const query = toPeriodQuery(dayjs('2026-11-06'), dayjs('2026-11-07 23:59'))

    expect(query.end).toBe('2026-11-08 00:00')
  })

  it('should build the period from the displayed dates', () => {
    const period = buildPeriod('Nov 6 - Nov 7', dayjs('2026-11-06'), dayjs('2026-11-07'))

    expect(period).toEqual({
      name: 'Nov 6 - Nov 7',
      query: { start: '2026-11-06 00:00', end: '2026-11-08 00:00' },
    })
  })

  it('should cover today and the previous days for the preset ranges', () => {
    const today = dayjs().startOf('day')
    const todayRange = getRangeSelection(0)
    const last7Days = getRangeSelection(7)

    expect(todayRange.end.isSame(today)).toBe(true)
    expect(last7Days.start.isSame(today.subtract(7, 'day'))).toBe(true)
    expect(toPeriodQuery(todayRange.start, todayRange.end).end).toBe(
      today.add(1, 'day').format('YYYY-MM-DD HH:mm'),
    )
  })
})
