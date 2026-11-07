import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

export type AgentMonitoringPeriodQuery = {
  start: string
  end: string
}

export type AgentMonitoringPeriod = {
  name: string
  query: AgentMonitoringPeriodQuery
}

const queryDateFormat = 'YYYY-MM-DD HH:mm'

/**
 * The statistics endpoints treat the range as half-open (`start <= created_at < end`),
 * while the picker only exposes whole days. The query therefore has to end at the
 * midnight that follows the selected end date; sending the selected date itself drops
 * that whole day, and sending `23:59` drops everything after the first minute of 23:59.
 */
export const toPeriodQuery = (start: Dayjs, end: Dayjs): AgentMonitoringPeriodQuery => ({
  start: start.startOf('day').format(queryDateFormat),
  end: end.startOf('day').add(1, 'day').format(queryDateFormat),
})

export const buildPeriod = (name: string, start: Dayjs, end: Dayjs): AgentMonitoringPeriod => ({
  name,
  query: toPeriodQuery(start, end),
})

/** `days` counts the days before the selected end date, so the window is `days + 1` long. */
export const getRangeSelection = (days: number) => {
  const today = dayjs()
  const end = today.startOf('day')
  const start = today.subtract(days, 'day').startOf('day')

  return { start, end }
}
