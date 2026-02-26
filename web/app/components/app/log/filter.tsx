'use client'
import type { FC } from 'react'
import type { QueryParam } from './index'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { RiCalendarLine } from '@remixicon/react'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import Input from '@/app/components/base/input'
import Sort from '@/app/components/base/sort'
import { useAnnotationsCount } from '@/service/use-log'

dayjs.extend(quarterOfYear)

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

export const TIME_PERIOD_MAPPING: { [key: string]: { value: number, name: TimePeriodName } } = {
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

const Filter: FC<IFilterProps> = ({ isChatMode, appId, queryParams, setQueryParams }: IFilterProps) => {
  const { data, isLoading } = useAnnotationsCount(appId)
  const { t } = useTranslation()
  if (isLoading || !data)
    return null
  return (
    <div className="mb-2 flex flex-row flex-wrap items-center gap-2">
      <Chip
        className="min-w-[150px]"
        panelClassName="w-[270px]"
        leftIcon={<RiCalendarLine className="h-4 w-4 text-text-secondary" />}
        value={queryParams.period}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, period: item.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, period: '9' })}
        items={Object.entries(TIME_PERIOD_MAPPING).map(([k, v]) => ({ value: k, name: t(`filter.period.${v.name}`, { ns: 'appLog' }) }))}
      />
      <Chip
        className="min-w-[150px]"
        panelClassName="w-[270px]"
        showLeftIcon={false}
        value={queryParams.annotation_status || 'all'}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, annotation_status: item.value as string })
        }}
        onClear={() => setQueryParams({ ...queryParams, annotation_status: 'all' })}
        items={[
          { value: 'all', name: t('filter.annotation.all', { ns: 'appLog' }) },
          { value: 'annotated', name: t('filter.annotation.annotated', { ns: 'appLog', count: data?.count }) },
          { value: 'not_annotated', name: t('filter.annotation.not_annotated', { ns: 'appLog' }) },
        ]}
      />
      <Input
        wrapperClassName="w-[200px]"
        showLeftIcon
        showClearIcon
        value={queryParams.keyword}
        placeholder={t('operation.search', { ns: 'common' })!}
        onChange={(e) => {
          setQueryParams({ ...queryParams, keyword: e.target.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, keyword: '' })}
      />
      {isChatMode && (
        <>
          <div className="h-3.5 w-px bg-divider-regular"></div>
          <Sort
            order={queryParams.sort_by?.startsWith('-') ? '-' : ''}
            value={queryParams.sort_by?.replace('-', '') || 'created_at'}
            items={[
              { value: 'created_at', name: t('table.header.time', { ns: 'appLog' }) },
              { value: 'updated_at', name: t('table.header.updatedTime', { ns: 'appLog' }) },
            ]}
            onSelect={(value) => {
              setQueryParams({ ...queryParams, sort_by: value as string })
            }}
          />
        </>
      )}
    </div>
  )
}

export default Filter
