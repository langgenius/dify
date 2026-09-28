'use client'

import type { DatePickerProps } from '@langgenius/dify-ui/date-picker'
import {
  DatePickerClear,
  DatePickerContent,
  DatePickerTrigger,
  DatePickerValue,
} from '@langgenius/dify-ui/date-picker'
import { useTranslation } from 'react-i18next'
import { DatePicker } from '@/app/components/base/date-time-picker/date-picker'
import { parseDateValue } from '@/app/components/base/date-time-picker/date-value'

type Props = Pick<
  DatePickerProps,
  'label' | 'labelledBy' | 'placeholder' | 'readOnly' | 'minDate' | 'maxDate'
> & {
  value: unknown
  onChange: (next: string) => void
  clearLabel?: string
}

export function ToolDatePicker({
  value,
  onChange,
  label,
  labelledBy,
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
      label={label}
      labelledBy={labelledBy}
      placeholder={placeholder}
      readOnly={readOnly}
      minDate={parseDateValue(minDate)}
      maxDate={parseDateValue(maxDate)}
    >
      <div className="flex w-full min-w-0 items-center rounded-lg bg-components-input-bg-normal">
        <DatePickerTrigger className="min-w-0 flex-1 px-2">
          <span
            className="i-ri-calendar-line size-4 shrink-0 text-text-tertiary"
            aria-hidden="true"
          />
          <DatePickerValue className="min-w-0 flex-1 truncate" />
        </DatePickerTrigger>
        <DatePickerClear label={clearLabel ?? t(($) => $['operation.clear'], { ns: 'common' })} />
      </div>
      <DatePickerContent />
    </DatePicker>
  )
}
