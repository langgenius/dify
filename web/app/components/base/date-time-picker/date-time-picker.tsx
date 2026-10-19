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

/* oxlint-disable no-barrel-files/no-barrel-files -- Keep this localized picker and its unchanged parts/types in one component entry. */
export {
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
  DateTimePickerValue,
} from '@langgenius/dify-ui/date-time-picker'
/** @public Prop types for the complete localized picker composition. */
export type {
  DateTimePickerClearProps,
  DateTimePickerContentProps,
  DateTimePickerLabelProps,
  DateTimePickerProps,
  DateTimePickerTriggerProps,
  DateTimePickerValueProps,
} from '@langgenius/dify-ui/date-time-picker'
/* oxlint-enable no-barrel-files/no-barrel-files */
