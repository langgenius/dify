'use client'
import type { Dayjs } from 'dayjs'
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

type IFilterProps = {
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
}

const Filter: FC<IFilterProps> = ({ queryParams, setQueryParams }: IFilterProps) => {
  const { t } = useTranslation(['appLog', 'common'])
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
          setQueryParams({ ...queryParams, status: item.value as QueryParam['status'] })
          trackEvent('workflow_log_filter_status_selected', {
            workflow_log_filter_status: item.value as string,
          })
        }}
        onClear={() => setQueryParams({ ...queryParams, status: 'all' })}
        items={[
          { value: 'all', name: t(($) => $['status.all'], { ns: 'appLog' }) },
          { value: 'succeeded', name: t(($) => $['status.succeeded'], { ns: 'appLog' }) },
          { value: 'failed', name: t(($) => $['status.failed'], { ns: 'appLog' }) },
          { value: 'stopped', name: t(($) => $['status.stopped'], { ns: 'appLog' }) },
          {
            value: 'partial-succeeded',
            name: t(($) => $['status.partial-succeeded'], { ns: 'appLog' }),
          },
          { value: 'scheduled', name: t(($) => $['status.scheduled'], { ns: 'appLog' }) },
          { value: 'running', name: t(($) => $['status.running'], { ns: 'appLog' }) },
          { value: 'paused', name: t(($) => $['status.paused'], { ns: 'appLog' }) },
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
