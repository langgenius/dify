'use client'

import type { Dayjs } from 'dayjs'
import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import dayjs from 'dayjs'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import { useLocale } from '@/context/i18n'
import { formatToLocalTime } from '@/utils/format'

export type AgentMonitoringPeriod = {
  name: string
  query: {
    start: string
    end: string
  }
}

type TimeRangeKey = 'today' | 'last7days' | 'last30days'

type TimeRangeOption = {
  value: TimeRangeKey
  days: number
  nameKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.timeRanges.'>
}

type AgentMonitoringTimeRangePickerProps = {
  value: AgentMonitoringPeriod
  onChange: (period: AgentMonitoringPeriod) => void
}

const today = dayjs()
const queryDateFormat = 'YYYY-MM-DD HH:mm'

const timeRangeOptions: TimeRangeOption[] = [
  { value: 'today', days: 0, nameKey: 'agentDetail.monitoring.timeRanges.today' },
  { value: 'last7days', days: 7, nameKey: 'agentDetail.monitoring.timeRanges.last7days' },
  { value: 'last30days', days: 30, nameKey: 'agentDetail.monitoring.timeRanges.last30days' },
]

const getRangePeriod = (option: TimeRangeOption): AgentMonitoringPeriod => {
  const end = today.endOf('day')
  const start =
    option.days === 0 ? today.startOf('day') : today.subtract(option.days, 'day').startOf('day')

  return {
    name: option.value,
    query: {
      start: start.format(queryDateFormat),
      end: end.format(queryDateFormat),
    },
  }
}

function DateRangePart({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: Dayjs
  end: Dayjs
  onStartChange: (date?: Dayjs) => void
  onEndChange: (date?: Dayjs) => void
}) {
  const locale = useLocale()

  const renderDate = ({ value, handleClickTrigger, isOpen }: TriggerProps) => (
    <div
      role="button"
      tabIndex={0}
      data-open={isOpen ? 'true' : undefined}
      className={cn(
        'flex h-7 cursor-pointer items-center rounded-lg px-1 system-sm-regular text-components-input-text-filled hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-[open=true]:bg-state-base-hover',
      )}
      onClick={handleClickTrigger}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return

        event.preventDefault()
        event.currentTarget.click()
      }}
    >
      {value ? formatToLocalTime(value, locale, 'MMM D') : ''}
    </div>
  )

  const availableStartDate = end.subtract(30, 'day')
  const isStartDateDisabled = (date: Dayjs) => {
    if (date.isAfter(today, 'date')) return true

    return !(
      (date.isAfter(availableStartDate, 'date') || date.isSame(availableStartDate, 'date')) &&
      (date.isBefore(end, 'date') || date.isSame(end, 'date'))
    )
  }

  const availableEndDate = start.add(30, 'day')
  const isEndDateDisabled = (date: Dayjs) => {
    if (date.isAfter(today, 'date')) return true

    return !(
      (date.isAfter(start, 'date') || date.isSame(start, 'date')) &&
      (date.isBefore(availableEndDate, 'date') || date.isSame(availableEndDate, 'date'))
    )
  }

  return (
    <div className="flex h-8 items-center space-x-0.5 rounded-lg bg-components-input-bg-normal px-2">
      <span aria-hidden className="i-ri-calendar-line size-3.5 text-text-tertiary" />
      <DatePicker
        value={start}
        onChange={onStartChange}
        renderTrigger={renderDate}
        needTimePicker={false}
        onClear={noop}
        noConfirm
        getIsDateDisabled={isStartDateDisabled}
      />
      <span className="system-sm-regular text-text-tertiary">-</span>
      <DatePicker
        value={end}
        onChange={onEndChange}
        renderTrigger={renderDate}
        needTimePicker={false}
        onClear={noop}
        noConfirm
        getIsDateDisabled={isEndDateDisabled}
      />
    </div>
  )
}

export function AgentMonitoringTimeRangePicker({
  value,
  onChange,
}: AgentMonitoringTimeRangePickerProps) {
  const { t } = useTranslation('agentV2')
  const locale = useLocale()
  const [selectedRange, setSelectedRange] = useState<TimeRangeKey | 'custom'>('today')
  const [start, setStart] = useState(() => dayjs(value.query.start))
  const [end, setEnd] = useState(() => dayjs(value.query.end))

  const selectedOption = timeRangeOptions.find((option) => option.value === selectedRange)

  const handleRangeChange = (nextValue: string | null) => {
    if (!nextValue) return

    const option = timeRangeOptions.find((item) => item.value === nextValue)
    if (!option) return

    const nextPeriod = getRangePeriod(option)
    setSelectedRange(option.value)
    setStart(dayjs(nextPeriod.query.start))
    setEnd(dayjs(nextPeriod.query.end))
    onChange({
      ...nextPeriod,
      name: t(($) => $[option.nameKey]),
    })
  }

  const handleDateChange = (type: 'start' | 'end') => (date?: Dayjs) => {
    if (!date) return

    if (type === 'start' && date.isSame(start)) return

    if (type === 'end' && date.isSame(end)) return

    const nextStart = type === 'start' ? date : start
    const nextEnd = type === 'end' ? date : end
    const nextName = `${formatToLocalTime(nextStart, locale, 'MMM D')} - ${formatToLocalTime(nextEnd, locale, 'MMM D')}`

    setSelectedRange('custom')
    setStart(nextStart)
    setEnd(nextEnd)
    onChange({
      name: nextName,
      query: {
        start: nextStart.format(queryDateFormat),
        end: nextEnd.format(queryDateFormat),
      },
    })
  }

  return (
    <div className="flex min-w-0 items-center">
      <Select
        value={selectedRange === 'custom' ? null : selectedRange}
        onValueChange={handleRangeChange}
      >
        <SelectTrigger
          aria-label={t(($) => $['agentDetail.monitoring.timeRangeLabel'])}
          className="mt-0 h-auto w-20 shrink-0 border-0 bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent [&>*:last-child]:hidden"
        >
          <div className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal pr-2 pl-3 group-data-popup-open:bg-state-base-hover-alt">
            <div className="system-sm-regular text-components-input-text-filled">
              {selectedRange === 'custom'
                ? t(($) => $['agentDetail.monitoring.timeRanges.custom'])
                : selectedOption
                  ? t(($) => $[selectedOption.nameKey])
                  : value.name}
            </div>
            <span
              aria-hidden
              className="i-ri-arrow-down-s-line size-4 text-text-quaternary group-data-popup-open:text-text-secondary"
            />
          </div>
        </SelectTrigger>
        <SelectContent className="translate-x-[-24px]" popupClassName="w-50" listClassName="p-1">
          {timeRangeOptions.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="h-8 py-0 pr-2 pl-7 system-md-regular"
            >
              <SelectItemText className="px-0">{t(($) => $[option.nameKey])}</SelectItemText>
              <SelectItemIndicator className="absolute top-2 left-2 ml-0" />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span
        aria-hidden
        className="i-custom-vender-other-hourglass-shape h-3.5 w-2 text-components-input-bg-normal"
      />
      <DateRangePart
        start={start}
        end={end}
        onStartChange={handleDateChange('start')}
        onEndChange={handleDateChange('end')}
      />
    </div>
  )
}
