'use client'
import type { FC, ReactNode } from 'react'
import type { QueryParam } from './index'
import type { LogIdentity } from './log-filters'
import { skipToken, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import { Sort } from '@/app/components/base/sort'
import { consoleQuery } from '@/service/console'
import {
  CLOUD_SANDBOX_CLEARED_TIME_PERIOD,
  CLOUD_SANDBOX_TIME_PERIOD_KEYS,
  isLogTimePeriodRestricted,
  resolveLogTimePeriodOption,
  useCloudSandboxPlanStatus,
} from './cloud-sandbox-retention'
import { TIME_PERIOD_MAPPING } from './log-filters'
import { LogIdentityPicker } from './log-identity-picker'

type IFilterProps = {
  isChatMode?: boolean
  appId: string
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
  identityOptions?: LogIdentity[]
  actions?: ReactNode
}

const Filter: FC<IFilterProps> = ({
  isChatMode,
  appId,
  queryParams,
  setQueryParams,
  identityOptions,
  actions,
}: IFilterProps) => {
  const { data } = useQuery(
    consoleQuery.apps.byAppId.annotations.count.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const { t } = useTranslation(['appLog', 'common'])
  const planState = useCloudSandboxPlanStatus()
  const isTimePeriodRestricted = isLogTimePeriodRestricted(planState)
  const timePeriodEntries = Object.entries(TIME_PERIOD_MAPPING)
    .filter(([key]) => !isTimePeriodRestricted || CLOUD_SANDBOX_TIME_PERIOD_KEYS.has(key))
    .map(([key, option]) => [key, resolveLogTimePeriodOption(key, option, planState)] as const)

  return (
    <div className="mb-2 flex flex-row flex-wrap items-center gap-2">
      <Chip
        className="min-w-37.5"
        panelClassName="w-[270px]"
        leftIcon={<span className="i-ri-calendar-line size-4 text-text-secondary" aria-hidden />}
        value={queryParams.period}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, period: item.value })
        }}
        onClear={() =>
          setQueryParams({
            ...queryParams,
            period: isTimePeriodRestricted ? CLOUD_SANDBOX_CLEARED_TIME_PERIOD : '9',
          })
        }
        items={timePeriodEntries.map(([k, v]) => ({
          value: k,
          name: t(($) => $[`filter.period.${v.name}`], { ns: 'appLog' }),
        }))}
      />
      <Chip
        className="min-w-37.5"
        panelClassName="w-[270px]"
        disabled={!data}
        showLeftIcon={false}
        value={queryParams.annotation_status || 'all'}
        onSelect={(item) => {
          setQueryParams({
            ...queryParams,
            annotation_status: item.value as QueryParam['annotation_status'],
          })
        }}
        onClear={() => setQueryParams({ ...queryParams, annotation_status: 'all' })}
        items={[
          { value: 'all', name: t(($) => $['filter.annotation.all'], { ns: 'appLog' }) },
          {
            value: 'annotated',
            name: t(($) => $['filter.annotation.annotated'], {
              ns: 'appLog',
              count: data?.count ?? 0,
            }),
          },
          {
            value: 'not_annotated',
            name: t(($) => $['filter.annotation.not_annotated'], { ns: 'appLog' }),
          },
        ]}
      />
      <SearchInput
        className="w-50"
        value={queryParams.keyword ?? ''}
        placeholder={t(($) => $['operation.search'], { ns: 'common' })!}
        onValueChange={(value) => {
          setQueryParams({ ...queryParams, keyword: value })
        }}
      />
      {identityOptions && (
        <LogIdentityPicker
          options={identityOptions}
          value={queryParams.identities ?? []}
          onChange={(identities) => setQueryParams({ ...queryParams, identities })}
        />
      )}
      {isChatMode && (
        <>
          <div className="h-3.5 w-px bg-divider-regular"></div>
          <Sort
            value={{
              field: queryParams.sort_by?.endsWith('updated_at') ? 'updated_at' : 'created_at',
              order: queryParams.sort_by?.startsWith('-') ? 'desc' : 'asc',
            }}
            items={[
              { value: 'created_at', name: t(($) => $['table.header.time'], { ns: 'appLog' }) },
              {
                value: 'updated_at',
                name: t(($) => $['table.header.updatedTime'], { ns: 'appLog' }),
              },
            ]}
            onValueChange={({ field, order }) => {
              setQueryParams({ ...queryParams, sort_by: order === 'desc' ? `-${field}` : field })
            }}
          />
        </>
      )}
      {actions && <div className="ms-auto">{actions}</div>}
    </div>
  )
}

export default Filter
