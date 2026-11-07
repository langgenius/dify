'use client'

import type { Dayjs } from 'dayjs'
import type { AgentMonitoringPeriod } from './time-range'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { MonitoringDateRangePicker } from '@/app/components/app/monitoring/date-range-picker'
import { formatToLocalTime } from '@/utils/format'
import { buildPeriod, getRangeSelection } from './time-range'

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

const timeRangeOptions: TimeRangeOption[] = [
  { value: 'today', days: 0, nameKey: 'agentDetail.monitoring.timeRanges.today' },
  { value: 'last7days', days: 7, nameKey: 'agentDetail.monitoring.timeRanges.last7days' },
  { value: 'last30days', days: 30, nameKey: 'agentDetail.monitoring.timeRanges.last30days' },
]

export function AgentMonitoringTimeRangePicker({
  value,
  onChange,
}: AgentMonitoringTimeRangePickerProps) {
  const { t } = useTranslation(['agentV2'])
  const locale = useLocale()
  const [selectedRange, setSelectedRange] = useState<TimeRangeKey | 'custom'>('today')
  const [start, setStart] = useState(() => dayjs(value.query.start).startOf('day'))
  // `query.end` is the exclusive bound, so the selected end date is the day before it.
  const [end, setEnd] = useState(() => dayjs(value.query.end).subtract(1, 'day').startOf('day'))

  const selectedOption = timeRangeOptions.find((option) => option.value === selectedRange)

  const handleRangeChange = (nextValue: TimeRangeKey | null) => {
    if (!nextValue) return

    const option = timeRangeOptions.find((item) => item.value === nextValue)
    if (!option) return

    const { start: nextStart, end: nextEnd } = getRangeSelection(option.days)
    const nextName = t(($) => $[option.nameKey])
    setSelectedRange(option.value)
    setStart(nextStart)
    setEnd(nextEnd)
    onChange(buildPeriod(nextName, nextStart, nextEnd))
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
    onChange(buildPeriod(nextName, nextStart, nextEnd))
  }

  return (
    <div className="flex min-w-0 items-center">
      <Select<TimeRangeKey>
        value={selectedRange === 'custom' ? null : selectedRange}
        onValueChange={handleRangeChange}
      >
        <SelectTrigger
          aria-label={t(($) => $['agentDetail.monitoring.timeRangeLabel'])}
          className="w-fit shrink-0 cursor-pointer gap-1.5 ps-3 pe-2"
        >
          {selectedRange === 'custom'
            ? t(($) => $['agentDetail.monitoring.timeRanges.custom'])
            : selectedOption
              ? t(($) => $[selectedOption.nameKey])
              : value.name}
        </SelectTrigger>
        <SelectContent className="w-50">
          {timeRangeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <SelectItemText>{t(($) => $[option.nameKey])}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span
        aria-hidden
        className="i-custom-vender-other-hourglass-shape h-3.5 w-2 text-components-input-bg-normal"
      />
      <MonitoringDateRangePicker
        start={start}
        end={end}
        onStartChange={handleDateChange('start')}
        onEndChange={handleDateChange('end')}
      />
    </div>
  )
}
