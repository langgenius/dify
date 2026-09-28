'use client'

import type { TimePickerProps } from '@langgenius/dify-ui/time-picker'
import { TimePicker as BaseTimePicker } from '@langgenius/dify-ui/time-picker'
import { usePickerLabels } from './use-picker-labels'

export function TimePicker(props: TimePickerProps) {
  const defaults = usePickerLabels()
  return (
    <BaseTimePicker
      {...defaults}
      {...props}
      placeholder={props.placeholder ?? defaults.labels.title}
      locale={props.locale ?? defaults.locale}
      labels={{ ...defaults.labels, ...props.labels }}
    />
  )
}

/* oxlint-disable no-barrel-files/no-barrel-files -- Keep this localized picker and its unchanged parts/types in one component entry. */
export {
  TimePickerClear,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
  TimePickerValue,
} from '@langgenius/dify-ui/time-picker'
/** @public Prop types for the complete localized picker composition. */
export type {
  TimePickerClearProps,
  TimePickerContentProps,
  TimePickerLabelProps,
  TimePickerProps,
  TimePickerTriggerProps,
  TimePickerValueProps,
} from '@langgenius/dify-ui/time-picker'
/* oxlint-enable no-barrel-files/no-barrel-files */
