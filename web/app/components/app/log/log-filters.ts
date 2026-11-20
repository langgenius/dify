import type {
  Conversation,
  ConversationLogIdentityResponse,
  ConversationWithSummary,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Dayjs } from 'dayjs'
import type { I18nKeysByPrefix } from '@/types/i18n'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'

dayjs.extend(quarterOfYear)

// Count the days when the value is read, so a page left open past midnight still uses the current date.
// Round the result, because a daylight saving change makes some days 23 or 25 hours long.
const daysSince = (getStart: (today: Dayjs) => Dayjs) => {
  const today = dayjs().startOf('day')
  return Math.round(today.diff(getStart(today).startOf('day'), 'day', true))
}

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

export const TIME_PERIOD_MAPPING: { [key: string]: { value: number; name: TimePeriodName } } = {
  1: { value: 0, name: 'today' },
  2: { value: 7, name: 'last7days' },
  3: { value: 28, name: 'last4weeks' },
  4: {
    get value() {
      return daysSince((today) => today.subtract(3, 'month'))
    },
    name: 'last3months',
  },
  5: {
    get value() {
      return daysSince((today) => today.subtract(12, 'month'))
    },
    name: 'last12months',
  },
  6: {
    get value() {
      return daysSince((today) => today.startOf('month'))
    },
    name: 'monthToDate',
  },
  7: {
    get value() {
      return daysSince((today) => today.startOf('quarter'))
    },
    name: 'quarterToDate',
  },
  8: {
    get value() {
      return daysSince((today) => today.startOf('year'))
    },
    name: 'yearToDate',
  },
  9: { value: -1, name: 'allTime' },
}

export function logDateRange(days: number) {
  const today = dayjs()
  return {
    start: today.subtract(days, 'day').startOf('day').format('YYYY-MM-DD HH:mm'),
    end: today.endOf('day').format('YYYY-MM-DD HH:mm'),
  }
}

export type LogIdentity = ConversationLogIdentityResponse

export const identityKey = ({ id, source }: LogIdentity) => `${source}:${id}`

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

export function logIdentityFilters(identities: LogIdentity[] = []) {
  const end_user_ids = identities
    .filter((item) => item.source === 'end-user')
    .map((item) => item.id)
  const account_ids = identities.filter((item) => item.source === 'account').map((item) => item.id)
  return {
    ...(end_user_ids.length ? { end_user_ids } : {}),
    ...(account_ids.length ? { account_ids } : {}),
  }
}
