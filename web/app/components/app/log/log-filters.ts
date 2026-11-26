import type {
  Conversation,
  ConversationWithSummary,
  GetAppsByAppIdChatConversationsData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Dayjs } from 'dayjs'
import type { CloudSandboxPlanState } from '@/features/log-export/cloud-sandbox-retention'
import type { LogIdentity } from '@/features/log-export/log-identity'
import type { LogCustomDateRange } from '@/features/log-export/log-time-range'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { skipToken, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useTranslation } from 'react-i18next'
import {
  CLOUD_SANDBOX_CLEARED_TIME_PERIOD,
  CLOUD_SANDBOX_TIME_PERIOD_KEYS,
  isLogTimePeriodRestricted,
  resolveLogTimePeriod,
  resolveLogTimePeriodOption,
} from '@/features/log-export/cloud-sandbox-retention'
import { identityKey, logIdentityFilters } from '@/features/log-export/log-identity'
import { customLogDateRange } from '@/features/log-export/log-time-range'
import { consoleQuery } from '@/service/console'

dayjs.extend(quarterOfYear)
dayjs.extend(utc)
dayjs.extend(timezone)

// Count the days when the value is read, so a page left open past midnight still uses the current date.
// Round the result, because a daylight saving change makes some days 23 or 25 hours long.
const daysSince = (getStart: (today: Dayjs) => Dayjs) => {
  const today = dayjs().startOf('day')
  return Math.round(today.diff(getStart(today).startOf('day'), 'day', true))
}

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

type LogTimePeriod = { value: number; name: TimePeriodName; start?: (today: Dayjs) => Dayjs }

const calendarPeriod = (name: TimePeriodName, start: NonNullable<LogTimePeriod['start']>) => ({
  get value() {
    return daysSince(start)
  },
  name,
  start,
})

export const TIME_PERIOD_MAPPING: Record<string, LogTimePeriod> = {
  1: { value: 0, name: 'today' },
  2: { value: 7, name: 'last7days' },
  3: { value: 28, name: 'last4weeks' },
  4: calendarPeriod('last3months', (today) => today.subtract(3, 'month')),
  5: calendarPeriod('last12months', (today) => today.subtract(12, 'month')),
  6: calendarPeriod('monthToDate', (today) => today.startOf('month')),
  7: calendarPeriod('quarterToDate', (today) => today.startOf('quarter')),
  8: calendarPeriod('yearToDate', (today) => today.startOf('year')),
  9: { value: -1, name: 'allTime' },
}

export function logDateRange(
  period: string,
  planState: CloudSandboxPlanState,
  timezone: string,
  customRange?: LogCustomDateRange,
) {
  const effectivePeriod = resolveLogTimePeriod(period, planState)
  if (effectivePeriod === '9') return null
  if (effectivePeriod === 'custom' && customRange) return customLogDateRange(customRange, timezone)
  const today = dayjs().tz(timezone)
  const preset = effectivePeriod === 'custom' ? '2' : effectivePeriod
  const option: LogTimePeriod = resolveLogTimePeriodOption(
    preset,
    TIME_PERIOD_MAPPING[preset]!,
    planState,
  )
  return {
    start: (option.start?.(today) ?? today.subtract(option.value, 'day')).startOf('day'),
    end: today.endOf('day'),
  }
}

type ConversationsQuery = NonNullable<GetAppsByAppIdChatConversationsData['query']>

export type QueryParam = {
  period: string
  customRange?: LogCustomDateRange
  annotation_status?: ConversationsQuery['annotation_status']
  keyword?: string
  sort_by?: ConversationsQuery['sort_by']
  identities?: LogIdentity[]
}

export function useLogTimeFilterOptions(planState: CloudSandboxPlanState) {
  const { t } = useTranslation(['appLog'])
  const restricted = isLogTimePeriodRestricted(planState)
  const periods = Object.entries(TIME_PERIOD_MAPPING)
    .filter(([value]) => !restricted || CLOUD_SANDBOX_TIME_PERIOD_KEYS.has(value))
    .map(([value, option]) => {
      const { name } = resolveLogTimePeriodOption(value, option, planState)
      return { value, label: t(($) => $[`filter.period.${name}`], { ns: 'appLog' }) }
    })
  return {
    periods,
    allowCustom: !restricted,
    clearedPeriod: restricted ? CLOUD_SANDBOX_CLEARED_TIME_PERIOD : '9',
  }
}

export function useLogFilterOptions(appId: string, planState: CloudSandboxPlanState) {
  const { t } = useTranslation(['appLog'])
  const time = useLogTimeFilterOptions(planState)
  const { data } = useQuery(
    consoleQuery.apps.byAppId.annotations.count.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const annotations = [
    { value: 'all', label: t(($) => $['filter.annotation.all'], { ns: 'appLog' }) },
    {
      value: 'annotated',
      label: t(($) => $['filter.annotation.annotated'], { ns: 'appLog', count: data?.count ?? 0 }),
    },
    {
      value: 'not_annotated',
      label: t(($) => $['filter.annotation.not_annotated'], { ns: 'appLog' }),
    },
  ] satisfies { value: NonNullable<QueryParam['annotation_status']>; label: string }[]

  return {
    ...time,
    annotations,
    hasAnnotationCount: Boolean(data),
  }
}

export type LogFilterOptions = ReturnType<typeof useLogFilterOptions>

export function getLogIdentities(logs: (Conversation | ConversationWithSummary)[]): LogIdentity[] {
  const identities = new Map<string, LogIdentity>()
  for (const log of logs) {
    const identity =
      log.from_source === 'api' && log.from_end_user_id
        ? {
            id: log.from_end_user_id,
            label: log.from_end_user_session_id || log.from_end_user_id,
            source: 'end-user' as const,
          }
        : log.from_source === 'console' && log.from_account_id
          ? {
              id: log.from_account_id,
              label: log.from_account_name || log.from_account_id,
              source: 'account' as const,
            }
          : undefined
    if (identity) identities.set(identityKey(identity), identity)
  }
  return [...identities.values()]
}

export function toLogFilters(
  { period, customRange, identities, ...filters }: QueryParam,
  planState: CloudSandboxPlanState,
  timezone: string,
) {
  const range = logDateRange(period, planState, timezone, customRange)
  return {
    ...filters,
    ...logIdentityFilters(identities),
    ...(range && {
      start: range.start.format('YYYY-MM-DD HH:mm'),
      end: range.end.format('YYYY-MM-DD HH:mm'),
    }),
  }
}
