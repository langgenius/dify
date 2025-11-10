'use client'
import type { PeriodParams, PeriodParamsWithTimeRange } from '@/app/components/app/overview/app-chart'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { HourglassShape } from '@/app/components/base/icons/src/vender/other'
import RangeSelector from './range-selector'
import DatePicker from './date-picker'
import dayjs from 'dayjs'
import { useI18N } from '@/context/i18n'
import { formatToLocalTime } from '@/utils/format'

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
  const { locale } = useI18N()

  const [isCustomRange, setIsCustomRange] = useState(false)
  const [start, setStart] = useState<Dayjs>(today)
  const [end, setEnd] = useState<Dayjs>(today)

  const handleRangeChange = useCallback((payload: PeriodParamsWithTimeRange) => {
    setIsCustomRange(false)
    setStart(payload.query!.start)
    setEnd(payload.query!.end)
    onSelect({
      name: payload.name,
      query: {
        start: payload.query!.start.format(queryDateFormat),
        end: payload.query!.end.format(queryDateFormat),
      },
    })
  }, [onSelect, queryDateFormat])

  const handleDateChange = useCallback((type: 'start' | 'end') => {
    return (date?: Dayjs) => {
      if (!date) return
      if (type === 'start' && date.isSame(start)) return
      if (type === 'end' && date.isSame(end)) return
      if (type === 'start')
        setStart(date)
      else
        setEnd(date)

      const currStart = type === 'start' ? date : start
      const currEnd = type === 'end' ? date : end
      onSelect({
        name: `${formatToLocalTime(currStart, locale, 'MMM D')} - ${formatToLocalTime(currEnd, locale, 'MMM D')}`,
        query: {
          start: currStart.format(queryDateFormat),
          end: currEnd.format(queryDateFormat),
        },
      })

      setIsCustomRange(true)
    }
  }, [start, end, onSelect, locale, queryDateFormat])

  return (
    <div className='flex items-center'>
      <RangeSelector
        isCustomRange={isCustomRange}
        ranges={ranges}
        onSelect={handleRangeChange}
      />
      <HourglassShape className='h-3.5 w-2 text-components-input-bg-normal' />
      <DatePicker
        start={start}
        end={end}
        onStartChange={handleDateChange('start')}
        onEndChange={handleDateChange('end')}
      />
    </div>
  )
}
export default React.memo(TimeRangePicker)
