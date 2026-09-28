'use client'

import type { DatePickerProps } from '@langgenius/dify-ui/date-picker'
import { DatePicker as BaseDatePicker } from '@langgenius/dify-ui/date-picker'
import { getCalendarLocale } from './calendar-locales'
import { usePickerLabels } from './use-picker-labels'

export function DatePicker(props: DatePickerProps) {
  const defaults = usePickerLabels()
  return (
    <BaseDatePicker
      {...defaults}
      {...props}
      placeholder={props.placeholder ?? defaults.labels.backToDate}
      locale={getCalendarLocale(defaults.locale, props.locale)}
      labels={{ ...defaults.labels, ...props.labels }}
    />
  )
}
