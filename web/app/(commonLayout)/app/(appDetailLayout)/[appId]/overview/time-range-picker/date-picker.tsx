'use client'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import dayjs from 'dayjs'
import * as React from 'react'
import { useCallback } from 'react'
import DateRangePicker from '@/app/components/base/date-and-time-picker/date-range-picker'

type Props = Readonly<{
  start: Dayjs
  end: Dayjs
  onStartChange: (date?: Dayjs) => void
  onEndChange: (date?: Dayjs) => void
}>

const today = dayjs()
const DatePicker: FC<Props> = ({ start, end, onStartChange, onEndChange }) => {
  const availableStartDate = end.subtract(30, 'day')
  const startDateDisabled = useCallback(
    (date: Dayjs) => {
      if (date.isAfter(today, 'date')) return true
      return !(
        (date.isAfter(availableStartDate, 'date') || date.isSame(availableStartDate, 'date')) &&
        (date.isBefore(end, 'date') || date.isSame(end, 'date'))
      )
    },
    [availableStartDate, end],
  )

  const availableEndDate = start.add(30, 'day')
  const endDateDisabled = useCallback(
    (date: Dayjs) => {
      if (date.isAfter(today, 'date')) return true
      return !(
        (date.isAfter(start, 'date') || date.isSame(start, 'date')) &&
        (date.isBefore(availableEndDate, 'date') || date.isSame(availableEndDate, 'date'))
      )
    },
    [availableEndDate, start],
  )

  return (
    <DateRangePicker
      start={start}
      end={end}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
      getIsStartDateDisabled={startDateDisabled}
      getIsEndDateDisabled={endDateDisabled}
    />
  )
}
export default React.memo(DatePicker)
