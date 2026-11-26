'use client'

import type { LogCustomDateRange } from './log-time-range'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Chip from '@/app/components/base/chip'
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
} from '@/app/components/base/date-time-picker/date-picker'
import { formatToLocalTime } from '@/utils/format'
import { LogExportSelect } from './dialog'
import './log-time-range'

type LogTimeSelection<T extends string> = { period: T | 'custom'; customRange?: LogCustomDateRange }

export function LogTimeRangePicker<T extends string>({
  value,
  options,
  onChange,
  timezone,
  disabled = false,
  clearedPeriod,
  allowCustom = true,
}: {
  value: LogTimeSelection<T>
  options: { value: T; label: string }[]
  onChange: (value: LogTimeSelection<T>) => void
  timezone?: string
  disabled?: boolean
  clearedPeriod?: T
  allowCustom?: boolean
}) {
  const { t } = useTranslation(['appLog', 'time'])
  const locale = useLocale()
  const label = t(($) => $['export.timeRange'], { ns: 'appLog' })
  const items = allowCustom
    ? [
        ...options,
        { value: 'custom' as const, label: t(($) => $['filter.period.custom'], { ns: 'appLog' }) },
      ]
    : options
  const today = dayjs().tz(timezone)
  const todayDate = today.format('YYYY-MM-DD')
  const range = allowCustom && value.period === 'custom' ? value.customRange : undefined
  const dateTriggerClassName =
    clearedPeriod === undefined ? 'min-w-0 flex-1' : 'h-8 w-auto gap-1 px-2'

  function dateLabel(value: string) {
    if (clearedPeriod === undefined) return undefined
    const date = dayjs(value)
    return formatToLocalTime(date, locale, date.year() === today.year() ? 'MMM D' : 'MMM D, YYYY')
  }

  function selectPeriod(period: T | 'custom') {
    if (period !== 'custom') {
      onChange({ period, customRange: undefined })
      return
    }
    onChange({
      period,
      customRange: range ?? {
        start: today.subtract(7, 'day').format('YYYY-MM-DD'),
        end: todayDate,
      },
    })
  }

  return (
    <div
      className={clearedPeriod === undefined ? 'space-y-2' : 'flex flex-wrap items-center gap-2'}
    >
      {clearedPeriod === undefined ? (
        <LogExportSelect
          label={label}
          value={value.period}
          options={items}
          onChange={selectPeriod}
          disabled={disabled}
        />
      ) : (
        <Chip
          className={range ? undefined : 'min-w-37.5'}
          panelClassName="w-67.5"
          listClassName="max-h-none"
          leftIcon={<span className="i-ri-calendar-line size-4 text-text-secondary" aria-hidden />}
          value={value.period}
          items={items.map(({ value, label }) => ({ value, name: label }))}
          onSelect={({ value }) => selectPeriod(value)}
          onClear={() => selectPeriod(clearedPeriod)}
          disabled={disabled}
        />
      )}
      {range && (
        <div className="flex min-w-0 items-center gap-2">
          <DatePicker
            value={range.start}
            maxDate={range.end}
            disabled={disabled}
            onValueChange={(start) =>
              start && onChange({ period: 'custom', customRange: { ...range, start } })
            }
          >
            <DatePickerLabel className="sr-only">
              {t(($) => $['picker.startDate'], { ns: 'time' })}
            </DatePickerLabel>
            <DatePickerTrigger className={dateTriggerClassName}>
              <DatePickerValue>{dateLabel(range.start)}</DatePickerValue>
            </DatePickerTrigger>
            <DatePickerContent />
          </DatePicker>
          <span aria-hidden="true" className="text-text-tertiary">
            –
          </span>
          <DatePicker
            value={range.end}
            minDate={range.start}
            maxDate={todayDate}
            disabled={disabled}
            onValueChange={(end) =>
              end && onChange({ period: 'custom', customRange: { ...range, end } })
            }
          >
            <DatePickerLabel className="sr-only">
              {t(($) => $['picker.endDate'], { ns: 'time' })}
            </DatePickerLabel>
            <DatePickerTrigger className={dateTriggerClassName}>
              <DatePickerValue>{dateLabel(range.end)}</DatePickerValue>
            </DatePickerTrigger>
            <DatePickerContent />
          </DatePicker>
        </div>
      )}
    </div>
  )
}
