import type {
  GetAppsByAppIdWorkflowAppLogsData,
  WorkflowAppLogPartialResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { CloudSandboxPlanState } from '../log/cloud-sandbox-retention'
import type { LogIdentity } from '../log/log-filters'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useTranslation } from 'react-i18next'
import { resolveLogTimePeriodOption } from '../log/cloud-sandbox-retention'
import {
  identityKey,
  logIdentityFilters,
  TIME_PERIOD_MAPPING,
  useLogTimeFilterOptions,
} from '../log/log-filters'

dayjs.extend(utc)
dayjs.extend(timezone)

type WorkflowLogStatus = NonNullable<GetAppsByAppIdWorkflowAppLogsData['query']>['status']

export type WorkflowLogQuery = {
  period: string
  status?: WorkflowLogStatus | 'all'
  keyword?: string
  identities?: LogIdentity[]
}

const statuses = [
  'all',
  'succeeded',
  'failed',
  'stopped',
  'partial-succeeded',
  'scheduled',
  'running',
  'paused',
] as const satisfies readonly NonNullable<WorkflowLogQuery['status']>[]

export function useWorkflowLogFilterOptions(planState: CloudSandboxPlanState) {
  const { t } = useTranslation(['appLog'])
  return {
    ...useLogTimeFilterOptions(planState),
    statuses: statuses.map((value) => ({
      value,
      label: t(($) => $[`status.${value}`], { ns: 'appLog' }),
    })),
  }
}

export type WorkflowLogFilterOptions = ReturnType<typeof useWorkflowLogFilterOptions>

export function toWorkflowLogFilters(
  { period, status, keyword, identities }: WorkflowLogQuery,
  planState: CloudSandboxPlanState,
  timezone?: string,
) {
  const timePeriod = resolveLogTimePeriodOption(period, TIME_PERIOD_MAPPING[period]!, planState)
  return {
    ...(status && status !== 'all' ? { status } : {}),
    ...(keyword ? { keyword } : {}),
    ...(period !== '9'
      ? {
          created_at__after: dayjs()
            .subtract(timePeriod.value, 'day')
            .startOf('day')
            .tz(timezone)
            .format('YYYY-MM-DDTHH:mm:ssZ'),
          created_at__before: dayjs().endOf('day').tz(timezone).format('YYYY-MM-DDTHH:mm:ssZ'),
        }
      : {}),
    ...logIdentityFilters(identities),
  }
}

export function getWorkflowLogIdentities(logs: WorkflowAppLogPartialResponse[]): LogIdentity[] {
  const identities = new Map<string, LogIdentity>()
  for (const { created_by_end_user: endUser, created_by_account: account } of logs) {
    const identity = endUser
      ? { id: endUser.id, label: endUser.session_id || endUser.id, source: 'end-user' as const }
      : account
        ? { id: account.id, label: account.name || account.id, source: 'account' as const }
        : null
    if (identity) identities.set(identityKey(identity), identity)
  }
  return [...identities.values()]
}
