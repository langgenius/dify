'use client'
import type { FC } from 'react'
import type { QueryParam } from './index'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { RiCalendarLine } from '@remixicon/react'
import { skipToken, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
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

dayjs.extend(quarterOfYear)

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

export const TIME_PERIOD_MAPPING: { [key: string]: { value: number; name: TimePeriodName } } = {
  1: { value: 0, name: 'today' },
  2: { value: 7, name: 'last7days' },
  3: { value: 28, name: 'last4weeks' },
  4: { value: today.diff(today.subtract(3, 'month'), 'day'), name: 'last3months' },
  5: { value: today.diff(today.subtract(12, 'month'), 'day'), name: 'last12months' },
  6: { value: today.diff(today.startOf('month'), 'day'), name: 'monthToDate' },
  7: { value: today.diff(today.startOf('quarter'), 'day'), name: 'quarterToDate' },
  8: { value: today.diff(today.startOf('year'), 'day'), name: 'yearToDate' },
  9: { value: -1, name: 'allTime' },
}

type IFilterProps = {
  isChatMode?: boolean
  appId: string
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
}

const Filter: FC<IFilterProps> = ({
  isChatMode,
  appId,
  queryParams,
  setQueryParams,
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
        leftIcon={<RiCalendarLine className="size-4 text-text-secondary" />}
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
    </div>
  )
}

export default Filter
