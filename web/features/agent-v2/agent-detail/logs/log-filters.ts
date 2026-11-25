import type { GetAgentByAgentIdLogExportsPreviewData } from '@dify/contracts/api/console/agent/types.gen'
import type { SourceFilterValue } from './components/source-picker'
import type { LogIdentity } from '@/features/log-export/log-identity'
import type { LogCustomDateRange } from '@/features/log-export/log-time-range'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { logIdentityFilters } from '@/features/log-export/log-identity'
import { customLogDateRange } from '@/features/log-export/log-time-range'

dayjs.extend(utc)
dayjs.extend(timezone)

export const agentLogPeriods = ['last7days', 'last30days', 'allTime'] as const

export type AgentLogFilters = {
  period: (typeof agentLogPeriods)[number] | 'custom'
  customRange?: LogCustomDateRange
  sources: SourceFilterValue
  identities: LogIdentity[]
}

export const defaultAgentLogFilters: AgentLogFilters = {
  period: 'last7days',
  sources: [],
  identities: [],
}

export function toAgentLogQuery(
  { period, customRange, sources, identities }: AgentLogFilters,
  timezone: string,
): NonNullable<GetAgentByAgentIdLogExportsPreviewData['query']> {
  const now = dayjs().tz(timezone)
  const format = 'YYYY-MM-DD HH:mm'
  const range =
    period === 'custom' && customRange ? customLogDateRange(customRange, timezone) : undefined
  const start = range?.start ?? now.subtract(period === 'last30days' ? 30 : 7, 'day')
  // The Agent query uses an exclusive end, so include the whole selected day.
  const end = range ? range.end.add(1, 'millisecond').tz(timezone) : now.add(1, 'minute')
  return {
    ...(period !== 'allTime' && {
      start: start.format(format),
      end: end.format(format),
    }),
    ...(sources.length > 0 && { sources }),
    ...logIdentityFilters(identities),
  }
}
