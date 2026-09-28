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
