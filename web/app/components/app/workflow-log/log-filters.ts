import type {
  GetAppsByAppIdWorkflowAppLogsData,
  WorkflowAppLogPartialResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { CloudSandboxPlanState } from '@/features/log-export/cloud-sandbox-retention'
import type { LogIdentity } from '@/features/log-export/log-identity'
import type { LogCustomDateRange } from '@/features/log-export/log-time-range'
import { useTranslation } from 'react-i18next'
import { identityKey, logIdentityFilters } from '@/features/log-export/log-identity'
import { logDateRange, useLogTimeFilterOptions } from '../log/log-filters'

type WorkflowLogStatus = NonNullable<GetAppsByAppIdWorkflowAppLogsData['query']>['status']

export type WorkflowLogQuery = {
  period: string
  customRange?: LogCustomDateRange
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
  { period, customRange, status, keyword, identities }: WorkflowLogQuery,
  planState: CloudSandboxPlanState,
  timezone: string,
) {
  const range = logDateRange(period, planState, timezone, customRange)
  return {
    ...(status && status !== 'all' ? { status } : {}),
    ...(keyword ? { keyword } : {}),
    ...(range && {
      created_at__after: range.start.utc().format('YYYY-MM-DDTHH:mm:ss[Z]'),
      // The inclusive custom bound covers the final microsecond of the selected day.
      created_at__before: range.end
        .utc()
        .format(period === 'custom' ? 'YYYY-MM-DDTHH:mm:ss.SSS[999Z]' : 'YYYY-MM-DDTHH:mm:ss[Z]'),
    }),
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
