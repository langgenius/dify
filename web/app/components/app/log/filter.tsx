'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import dayjs from 'dayjs'
import { RiCalendarLine } from '@remixicon/react'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import type { QueryParam } from './index'
import Chip from '@/app/components/base/chip'
import Input from '@/app/components/base/input'
import Sort from '@/app/components/base/sort'
import { fetchAnnotationsCount } from '@/service/log'
dayjs.extend(quarterOfYear)

const today = dayjs()

export const TIME_PERIOD_LIST = [
  { value: 0, name: 'today' },
  { value: 7, name: 'last7days' },
  { value: 28, name: 'last4weeks' },
  { value: today.diff(today.subtract(3, 'month'), 'day'), name: 'last3months' },
  { value: today.diff(today.subtract(12, 'month'), 'day'), name: 'last12months' },
  { value: today.diff(today.startOf('month'), 'day'), name: 'monthToDate' },
  { value: today.diff(today.startOf('quarter'), 'day'), name: 'quarterToDate' },
  { value: today.diff(today.startOf('year'), 'day'), name: 'yearToDate' },
  { value: 'all', name: 'allTime' },
]

type IFilterProps = {
  isChatMode?: boolean
  appId: string
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
}

const Filter: FC<IFilterProps> = ({ isChatMode, appId, queryParams, setQueryParams }: IFilterProps) => {
  const { data } = useSWR({ url: `/apps/${appId}/annotations/count` }, fetchAnnotationsCount)
  const { t } = useTranslation()
  if (!data)
    return null
  return (
    <div className='flex flex-row flex-wrap gap-2 items-center mb-2'>
      <Chip
        className='min-w-[150px]'
        panelClassName='w-[270px]'
        leftIcon={<RiCalendarLine className='h-4 w-4 text-text-secondary' />}
        value={queryParams.period || 7}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, period: item.value as string })
        }}
        onClear={() => setQueryParams({ ...queryParams, period: 7 })}
        items={TIME_PERIOD_LIST.map(item => ({ value: item.value, name: t(`appLog.filter.period.${item.name}`) }))}
      />
      <Chip
        className='min-w-[150px]'
        panelClassName='w-[270px]'
        showLeftIcon={false}
        value={queryParams.annotation_status || 'all'}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, annotation_status: item.value as string })
        }}
        onClear={() => setQueryParams({ ...queryParams, annotation_status: 'all' })}
        items={[
          { value: 'all', name: t('appLog.filter.annotation.all') },
          { value: 'annotated', name: t('appLog.filter.annotation.annotated', { count: data?.count }) },
          { value: 'not_annotated', name: t('appLog.filter.annotation.not_annotated') },
        ]}
      />
      <Input
        wrapperClassName='w-[200px]'
        showLeftIcon
        showClearIcon
        value={queryParams.keyword}
        placeholder={t('common.operation.search')!}
        onChange={(e) => {
          setQueryParams({ ...queryParams, keyword: e.target.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, keyword: '' })}
      />
      {isChatMode && (
        <>
          <div className='w-px h-3.5 bg-divider-regular'></div>
          <Sort
            order={queryParams.sort_by?.startsWith('-') ? '-' : ''}
            value={queryParams.sort_by?.replace('-', '') || 'created_at'}
            items={[
              { value: 'created_at', name: t('appLog.table.header.time') },
              { value: 'updated_at', name: t('appLog.table.header.updatedTime') },
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
