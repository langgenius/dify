import type { GetAgentByAgentIdLogExportsPreviewData } from '@dify/contracts/api/console/agent/types.gen'
import type { SourceFilterValue } from './components/source-picker'
import type { LogIdentity } from '@/features/log-export/log-identity'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { logIdentityFilters } from '@/features/log-export/log-identity'

dayjs.extend(utc)
dayjs.extend(timezone)

export const agentLogPeriods = ['last7days', 'last30days', 'allTime'] as const

export type AgentLogFilters = {
  period: (typeof agentLogPeriods)[number]
  sources: SourceFilterValue
  identities: LogIdentity[]
}

export const defaultAgentLogFilters: AgentLogFilters = {
  period: 'last7days',
  sources: [],
  identities: [],
}

export function toAgentLogQuery(
  { period, sources, identities }: AgentLogFilters,
  timezone: string,
): NonNullable<GetAgentByAgentIdLogExportsPreviewData['query']> {
  const now = dayjs().tz(timezone)
  const format = 'YYYY-MM-DD HH:mm'
  return {
    ...(period !== 'allTime' && {
      start: now.subtract(period === 'last7days' ? 7 : 30, 'day').format(format),
      end: now.add(1, 'minute').format(format),
    }),
    ...(sources.length > 0 && { sources }),
    ...logIdentityFilters(identities),
  }
}
