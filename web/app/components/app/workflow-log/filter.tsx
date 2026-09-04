'use client'
import type { FC } from 'react'
import type { QueryParam } from './index'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { RiCalendarLine } from '@remixicon/react'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude/utils'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import {
  CLOUD_SANDBOX_CLEARED_TIME_PERIOD,
  CLOUD_SANDBOX_TIME_PERIOD_KEYS,
  isLogTimePeriodRestricted,
  resolveLogTimePeriodOption,
  useCloudSandboxPlanStatus,
} from '../log/cloud-sandbox-retention'

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
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
}

const Filter: FC<IFilterProps> = ({ queryParams, setQueryParams }: IFilterProps) => {
  const { t } = useTranslation()
  const planState = useCloudSandboxPlanStatus()
  const isTimePeriodRestricted = isLogTimePeriodRestricted(planState)
  const timePeriodEntries = Object.entries(TIME_PERIOD_MAPPING)
    .filter(([key]) => !isTimePeriodRestricted || CLOUD_SANDBOX_TIME_PERIOD_KEYS.has(key))
    .map(([key, option]) => [key, resolveLogTimePeriodOption(key, option, planState)] as const)

  return (
    <div className="mb-2 flex flex-row flex-wrap gap-2">
      <Chip
        value={queryParams.status || 'all'}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, status: item.value as string })
          trackEvent('workflow_log_filter_status_selected', {
            workflow_log_filter_status: item.value as string,
          })
        }}
        onClear={() => setQueryParams({ ...queryParams, status: 'all' })}
        items={[
          { value: 'all', name: 'All' },
          { value: 'succeeded', name: 'Success' },
          { value: 'failed', name: 'Fail' },
          { value: 'stopped', name: 'Stop' },
          { value: 'partial-succeeded', name: 'Partial Success' },
        ]}
      />
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
      <SearchInput
        className="w-50"
        value={queryParams.keyword ?? ''}
        placeholder={t(($) => $['operation.search'], { ns: 'common' })!}
        onValueChange={(value) => {
          setQueryParams({ ...queryParams, keyword: value })
        }}
      />
    </div>
  )
}

export default Filter
