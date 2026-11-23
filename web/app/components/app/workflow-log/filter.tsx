'use client'

import type { ReactNode } from 'react'
import type { WorkflowLogFilterOptions, WorkflowLogQuery } from './log-filters'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude/utils'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import { LogIdentityField } from '@/features/log-export/log-identity-picker'

type IFilterProps = {
  appId: string
  queryParams: WorkflowLogQuery
  setQueryParams: (value: WorkflowLogQuery) => void
  filterOptions: WorkflowLogFilterOptions
  identityOptions: LogIdentity[]
  actions?: ReactNode
}

export default function Filter({
  appId,
  queryParams,
  setQueryParams,
  filterOptions,
  identityOptions,
  actions,
}: IFilterProps) {
  const { t } = useTranslation(['common'])

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Chip
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
      <Chip
        className="min-w-37.5"
        panelClassName="w-[270px]"
        leftIcon={<span className="i-ri-calendar-line size-4 text-text-secondary" aria-hidden />}
        value={queryParams.period}
        onSelect={({ value: period }) => setQueryParams({ ...queryParams, period })}
        onClear={() => setQueryParams({ ...queryParams, period: filterOptions.clearedPeriod })}
        items={filterOptions.periods.map(({ value, label }) => ({ value, name: label }))}
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
