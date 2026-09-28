'use client'

import type { DateTimePickerProps } from '@langgenius/dify-ui/date-time-picker'
import { DateTimePicker as BaseDateTimePicker } from '@langgenius/dify-ui/date-time-picker'
import { getCalendarLocale } from './calendar-locales'
import { usePickerLabels } from './use-picker-labels'

export function DateTimePicker(props: DateTimePickerProps) {
  const defaults = usePickerLabels()
  return (
    <BaseDateTimePicker
      {...defaults}
      {...props}
      placeholder={props.placeholder ?? defaults.labels.backToDate}
      locale={getCalendarLocale(defaults.locale, props.locale)}
      labels={{ ...defaults.labels, ...props.labels }}
    />
  )
}
