'use client'

import type { DatePickerProps } from '@langgenius/dify-ui/date-picker'
import { DatePicker as BaseDatePicker } from '@langgenius/dify-ui/date-picker'
import { Suspense } from 'react'
import { useCalendarLocale } from './calendar-locales'
import { usePickerLabels } from './use-picker-labels'

function LocalizedDatePicker(props: DatePickerProps) {
  const defaults = usePickerLabels()
  const locale = useCalendarLocale(defaults.locale, props.locale)
  return (
    <BaseDatePicker
      {...defaults}
      {...props}
      placeholder={props.placeholder ?? defaults.labels.backToDate}
      locale={locale}
      labels={{ ...defaults.labels, ...props.labels }}
    />
  )
}

export function DatePicker(props: DatePickerProps) {
  return (
    <Suspense fallback={null}>
      <LocalizedDatePicker {...props} />
    </Suspense>
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
/**
 * Prop types for the complete localized picker composition.
 * @public
 */
export type {
  DatePickerClearProps,
  DatePickerContentProps,
  DatePickerLabelProps,
  DatePickerProps,
  DatePickerTriggerProps,
  DatePickerValueProps,
} from '@langgenius/dify-ui/date-picker'
/* oxlint-enable no-barrel-files/no-barrel-files */
