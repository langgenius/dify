'use client'
import type { PeriodParams, PeriodParamsWithTimeRange } from '@/app/components/app/overview/app-chart'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { HourglassShape } from '@/app/components/base/icons/src/vender/other'
import RangeSelector from './range-selector'
import DatePicker from './date-picker'
import dayjs from 'dayjs'

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
  }, [onSelect])

  const handleStartChange = useCallback((date?: Dayjs) => {
    if (!date) return
    setStart(date)
    setIsCustomRange(true)
    onSelect({ name: 'custom', query: { start: date.format(queryDateFormat), end: end.format(queryDateFormat) } })
  }, [end, onSelect, queryDateFormat])

  const handleEndChange = useCallback((date?: Dayjs) => {
    if (!date) return
    setEnd(date)
    setIsCustomRange(true)
    onSelect({ name: 'custom', query: { start: start.format(queryDateFormat), end: date.format(queryDateFormat) } })
  }, [start, onSelect, queryDateFormat])

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
        onStartChange={handleStartChange}
        onEndChange={handleEndChange}
      />
    </div>
  )
}
export default React.memo(TimeRangePicker)
