'use client'

import type { DateTimePickerProps } from '@langgenius/dify-ui/date-time-picker'
import { DateTimePicker as BaseDateTimePicker } from '@langgenius/dify-ui/date-time-picker'
import { Suspense } from 'react'
import { useCalendarLocale } from './calendar-locales'
import { usePickerLabels } from './use-picker-labels'

function LocalizedDateTimePicker(props: DateTimePickerProps) {
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

export function DateTimePicker(props: DateTimePickerProps) {
  return (
    <Suspense fallback={null}>
      <LocalizedDateTimePicker {...props} />
    </Suspense>
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
/**
 * Prop types for the complete localized picker composition.
 * @public
 */
export type {
  DateTimePickerClearProps,
  DateTimePickerContentProps,
  DateTimePickerLabelProps,
  DateTimePickerProps,
  DateTimePickerTriggerProps,
  DateTimePickerValueProps,
} from '@langgenius/dify-ui/date-time-picker'
/* oxlint-enable no-barrel-files/no-barrel-files */
