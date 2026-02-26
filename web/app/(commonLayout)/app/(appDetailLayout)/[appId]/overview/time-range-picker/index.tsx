'use client'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import type { PeriodParams, PeriodParamsWithTimeRange } from '@/app/components/app/overview/app-chart'
import type { I18nKeysByPrefix } from '@/types/i18n'
import dayjs from 'dayjs'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { HourglassShape } from '@/app/components/base/icons/src/vender/other'
import { useLocale } from '@/context/i18n'
import { formatToLocalTime } from '@/utils/format'
import DatePicker from './date-picker'
import RangeSelector from './range-selector'

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

type Props = {
  ranges: { value: number, name: TimePeriodName }[]
  onSelect: (payload: PeriodParams) => void
  queryDateFormat: string
}

const TimeRangePicker: FC<Props> = ({
  ranges,
  onSelect,
  queryDateFormat,
}) => {
  const locale = useLocale()

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
      if (!date)
        return
      if (type === 'start' && date.isSame(start))
        return
      if (type === 'end' && date.isSame(end))
        return
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
    <div className="flex items-center">
      <RangeSelector
        isCustomRange={isCustomRange}
        ranges={ranges}
        onSelect={handleRangeChange}
      />
      <HourglassShape className="h-3.5 w-2 text-components-input-bg-normal" />
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
