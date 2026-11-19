'use client'

import type { DateTimePickerProps } from '@langgenius/dify-ui/date-time-picker'
import { DateTimePicker as BaseDateTimePicker } from '@langgenius/dify-ui/date-time-picker'
import { useCalendarLocale } from './calendar-locales'
import { usePickerLabels } from './use-picker-labels'

export function DateTimePicker(props: DateTimePickerProps) {
  const defaults = usePickerLabels()
  const locale = useCalendarLocale(defaults.locale, props.locale)
  return (
    <BaseDateTimePicker
      {...defaults}
      {...props}
      placeholder={props.placeholder ?? defaults.labels.backToDate}
      locale={locale}
      labels={{ ...defaults.labels, ...props.labels }}
    />
  )
}

/* oxlint-disable no-barrel-files/no-barrel-files -- Keep this localized picker and its unchanged parts/types in one component entry. */
export {
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
  DateTimePickerValue,
} from '@langgenius/dify-ui/date-time-picker'
/** @public */
export type {
  DateTimePickerChangeEventDetails,
  DateTimePickerChangeEventReason,
  DateTimePickerClearProps,
  DateTimePickerContentProps,
  DateTimePickerLabelProps,
  DateTimePickerProps,
  DateTimePickerTriggerProps,
  DateTimePickerValueProps,
} from '@langgenius/dify-ui/date-time-picker'
/* oxlint-enable no-barrel-files/no-barrel-files */
