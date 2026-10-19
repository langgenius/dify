'use client'

import type {
  DatePickerProps,
  DatePickerTriggerProps,
} from '@/app/components/base/date-time-picker/date-picker'
import { useTranslation } from 'react-i18next'
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
} from '@/app/components/base/date-time-picker/date-picker'
import { parseDateValue } from '@/app/components/base/date-time-picker/date-value'

type Props = Pick<DatePickerProps, 'placeholder' | 'readOnly' | 'minDate' | 'maxDate'> &
  Pick<DatePickerTriggerProps, 'aria-label' | 'aria-labelledby'> & {
    value: unknown
    onChange: (next: string) => void
    clearLabel?: string
  }

export function ToolDatePicker({
  value,
  onChange,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  placeholder,
  clearLabel,
  readOnly = false,
  minDate,
  maxDate,
}: Props) {
  const { t } = useTranslation(['common'])
  return (
    <DatePicker
      value={parseDateValue(value) ?? null}
      onValueChange={(next) => onChange(next ?? '')}
      placeholder={placeholder}
      readOnly={readOnly}
      minDate={parseDateValue(minDate)}
      maxDate={parseDateValue(maxDate)}
    >
      {!ariaLabelledBy && <DatePickerLabel className="sr-only">{ariaLabel}</DatePickerLabel>}
      <div className="flex w-full min-w-0 items-center rounded-lg bg-components-input-bg-normal">
        <DatePickerTrigger aria-labelledby={ariaLabelledBy} className="min-w-0 flex-1 px-2">
          <span
            className="i-ri-calendar-line size-4 shrink-0 text-text-tertiary"
            aria-hidden="true"
          />
          <DatePickerValue className="min-w-0 flex-1 truncate" />
        </DatePickerTrigger>
        <DatePickerClear
          aria-label={clearLabel ?? t(($) => $['operation.clear'], { ns: 'common' })}
        />
      </div>
      <DatePickerContent aria-labelledby={ariaLabelledBy} />
    </DatePicker>
  )
}
