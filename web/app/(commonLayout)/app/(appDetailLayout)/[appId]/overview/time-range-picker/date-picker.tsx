'use client'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import { RiCalendarLine } from '@remixicon/react'
import dayjs from 'dayjs'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback } from 'react'
import Picker from '@/app/components/base/date-and-time-picker/date-picker'
import { useLocale } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { formatToLocalTime } from '@/utils/format'

type Props = {
  start: Dayjs
  end: Dayjs
  onStartChange: (date?: Dayjs) => void
  onEndChange: (date?: Dayjs) => void
}

const today = dayjs()
const DatePicker: FC<Props> = ({
  start,
  end,
  onStartChange,
  onEndChange,
}) => {
  const locale = useLocale()

  const renderDate = useCallback(({ value, handleClickTrigger, isOpen }: TriggerProps) => {
    return (
      <div className={cn('system-sm-regular flex h-7 cursor-pointer items-center rounded-lg px-1 text-components-input-text-filled hover:bg-state-base-hover', isOpen && 'bg-state-base-hover')} onClick={handleClickTrigger}>
        {value ? formatToLocalTime(value, locale, 'MMM D') : ''}
      </div>
    )
  }, [locale])

  const availableStartDate = end.subtract(30, 'day')
  const startDateDisabled = useCallback((date: Dayjs) => {
    if (date.isAfter(today, 'date'))
      return true
    return !((date.isAfter(availableStartDate, 'date') || date.isSame(availableStartDate, 'date')) && (date.isBefore(end, 'date') || date.isSame(end, 'date')))
  }, [availableStartDate, end])

  const availableEndDate = start.add(30, 'day')
  const endDateDisabled = useCallback((date: Dayjs) => {
    if (date.isAfter(today, 'date'))
      return true
    return !((date.isAfter(start, 'date') || date.isSame(start, 'date')) && (date.isBefore(availableEndDate, 'date') || date.isSame(availableEndDate, 'date')))
  }, [availableEndDate, start])

  return (
    <div className="flex h-8 items-center space-x-0.5 rounded-lg bg-components-input-bg-normal px-2">
      <div className="p-px">
        <RiCalendarLine className="size-3.5 text-text-tertiary" />
      </div>
      <Picker
        value={start}
        onChange={onStartChange}
        renderTrigger={renderDate}
        needTimePicker={false}
        onClear={noop}
        noConfirm
        getIsDateDisabled={startDateDisabled}
      />
      <span className="system-sm-regular text-text-tertiary">-</span>
      <Picker
        value={end}
        onChange={onEndChange}
        renderTrigger={renderDate}
        needTimePicker={false}
        onClear={noop}
        noConfirm
        getIsDateDisabled={endDateDisabled}
      />
    </div>

  )
}
export default React.memo(DatePicker)
