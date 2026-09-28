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

/* oxlint-disable no-barrel-files/no-barrel-files -- Keep this localized picker and its unchanged parts/types in one component entry. */
export {
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
} from '@langgenius/dify-ui/date-picker'
/** @public Prop types for the complete localized picker composition. */
export type {
  DatePickerClearProps,
  DatePickerContentProps,
  DatePickerLabelProps,
  DatePickerProps,
  DatePickerTriggerProps,
  DatePickerValueProps,
} from '@langgenius/dify-ui/date-picker'
/* oxlint-enable no-barrel-files/no-barrel-files */
