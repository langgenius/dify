'use client'

import type { ReactNode } from 'react'
import type { WorkflowLogFilterOptions, WorkflowLogQuery } from './log-filters'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude/utils'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import { LogIdentityField } from '@/features/log-export/log-identity-picker'
import { LogTimeRangePicker } from '@/features/log-export/log-time-range-picker'

type IFilterProps = {
  appId: string
  queryParams: WorkflowLogQuery
  setQueryParams: (value: WorkflowLogQuery) => void
  filterOptions: WorkflowLogFilterOptions
  identityOptions: LogIdentity[]
  timezone?: string
  actions?: ReactNode
}

export default function Filter({
  appId,
  queryParams,
  setQueryParams,
  filterOptions,
  identityOptions,
  timezone,
  actions,
}: IFilterProps) {
  const { t } = useTranslation(['appLog', 'common'])

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Chip
        label={t(($) => $['table.header.status'], { ns: 'appLog' })}
        value={queryParams.status ?? 'all'}
        onSelect={({ value: status }) => {
          setQueryParams({ ...queryParams, status })
          trackEvent('workflow_log_filter_status_selected', {
            workflow_log_filter_status: status,
          })
        }}
        onClear={() => setQueryParams({ ...queryParams, status: 'all' })}
        items={filterOptions.statuses.map(({ value, label }) => ({ value, name: label }))}
      />
      <LogTimeRangePicker
        value={queryParams}
        options={filterOptions.periods}
        clearedPeriod={filterOptions.clearedPeriod}
        timezone={timezone}
        allowCustom={filterOptions.allowCustom}
        onChange={({ period, customRange }) =>
          setQueryParams({ ...queryParams, period, customRange })
        }
      />
      <LogIdentityField
        appId={appId}
        options={identityOptions}
        value={queryParams.identities ?? []}
        onChange={(identities) => setQueryParams({ ...queryParams, identities })}
        disabled={false}
        workflow
        applyOnClose
      />
      <SearchInput
        className="w-50"
        value={queryParams.keyword ?? ''}
        placeholder={t(($) => $['operation.search'], { ns: 'common' })}
        onValueChange={(keyword) => setQueryParams({ ...queryParams, keyword })}
      />
      {actions ? <div className="ms-auto">{actions}</div> : null}
    </div>
  )
}
