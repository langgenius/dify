'use client'
import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { SimpleSelect } from '@/app/components/base/select'
import type { Item } from '@/app/components/base/select'
import dayjs from 'dayjs'
import { HourglassShape } from '@/app/components/base/icons/src/vender/other'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import { noop } from 'lodash-es'
import { useTranslation } from 'react-i18next'

const today = dayjs()

type Props = {
  ranges: { value: number; name: string }[]
  onSelect: (payload: PeriodParams) => void
  queryDateFormat: string
}

const TimeRangePicker: FC<Props> = ({
  ranges,
  onSelect,
  queryDateFormat,
}) => {
  const { t } = useTranslation()

  const handleSelectRange = useCallback((item: Item) => {
    const { name, value } = item
    let period: PeriodParams['query'] | null = null
    if (value === 0) {
      const startOfToday = today.startOf('day').format(queryDateFormat)
      const endOfToday = today.endOf('day').format(queryDateFormat)
      period = { start: startOfToday, end: endOfToday }
    }
    else {
      period = { start: today.subtract(item.value as number, 'day').startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) }
    }
    onSelect({ query: period!, name })
  }, [onSelect])
  return (
    <div className='flex items-center'>
      <SimpleSelect
        items={ranges.map(v => ({ ...v, name: t(`appLog.filter.period.${v.name}`) }))}
        className='mt-0 !w-40'
        notClearable={true}
        onSelect={handleSelectRange}
        defaultValue={0}
      />
      <HourglassShape className='h-3.5 w-2 text-components-input-bg-normal' />
      <TimePicker
        value={today}
        onChange={noop}
      />
    </div>
  )
}
export default React.memo(TimeRangePicker)
