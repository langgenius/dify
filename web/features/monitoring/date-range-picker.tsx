'use client'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
} from '@/app/components/base/date-time-picker/date-picker'
import { formatToLocalTime } from '@/utils/format'
type Props = {
  start: Dayjs
  end: Dayjs
  onStartChange: (date: Dayjs) => void
  onEndChange: (date: Dayjs) => void
}
export function MonitoringDateRangePicker({ start, end, onStartChange, onEndChange }: Props) {
  const locale = useLocale()
  const { t } = useTranslation(['time'])
  const today = dayjs().format('YYYY-MM-DD')
  const startMax = [end.format('YYYY-MM-DD'), today].sort()[0]
  const endMax = [start.add(30, 'day').format('YYYY-MM-DD'), today].sort()[0]
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg bg-components-input-bg-normal px-2">
      <span aria-hidden="true" className="i-ri-calendar-line size-3.5 text-text-tertiary" />
      <DatePicker
        value={start.format('YYYY-MM-DD')}
        minDate={end.subtract(30, 'day').format('YYYY-MM-DD')}
        maxDate={startMax}
        onValueChange={(next) => {
          if (next) onStartChange(dayjs(next))
        }}
      >
        <DatePickerLabel className="sr-only">{t(($) => $['picker.startDate'])}</DatePickerLabel>
        <DatePickerTrigger className="h-7 w-auto px-1">
          <DatePickerValue>{formatToLocalTime(start, locale, 'MMM D')}</DatePickerValue>
        </DatePickerTrigger>
        <DatePickerContent />
      </DatePicker>
      <span aria-hidden="true">–</span>
      <DatePicker
        value={end.format('YYYY-MM-DD')}
        minDate={start.format('YYYY-MM-DD')}
        maxDate={endMax}
        onValueChange={(next) => {
          if (next) onEndChange(dayjs(next))
        }}
      >
        <DatePickerLabel className="sr-only">{t(($) => $['picker.endDate'])}</DatePickerLabel>
        <DatePickerTrigger className="h-7 w-auto px-1">
          <DatePickerValue>{formatToLocalTime(end, locale, 'MMM D')}</DatePickerValue>
        </DatePickerTrigger>
        <DatePickerContent />
      </DatePicker>
    </div>
  )
}
