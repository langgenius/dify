'use client'

import type { FC } from 'react'
import type {
  DatePickerProps,
  TriggerProps,
} from '@/app/components/base/date-and-time-picker/types'
import { cn } from '@langgenius/dify-ui/cn'
import { noop } from 'es-toolkit/function'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import { toDayjs } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { useLocale } from '@/context/i18n'
import { formatToLocalTime } from '@/utils/format'

const DATE_FMT = 'YYYY-MM-DD'

type Props = Readonly<{
  value: unknown
  onChange: (next: string) => void
  timezone: string
  placeholder?: string
  readOnly?: boolean
}>

const ToolDatePicker: FC<Props> = ({
  value,
  onChange,
  timezone,
  placeholder,
  readOnly = false,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const displayFormat = t(($) => $['dateFormats.display'], { ns: 'time' })
  const resolvedPlaceholder = placeholder || t(($) => $['operation.pickDate'], { ns: 'time' })
  const rawValue = typeof value === 'string' ? value : ''
  const parsedValue = toDayjs(rawValue, { timezone, format: DATE_FMT })

  const renderTrigger = useCallback<NonNullable<DatePickerProps['renderTrigger']>>(
    (props, _state, { value: date, handleClear }: TriggerProps) => {
      const displayValue = date ? formatToLocalTime(date, locale, displayFormat) : ''
      const triggerLabel = resolvedPlaceholder
        ? `${resolvedPlaceholder}${displayValue ? `: ${displayValue}` : ''}`
        : displayValue

      return (
        <div className="group/date-trigger relative w-full min-w-0">
          <button
            {...props}
            type="button"
            aria-label={triggerLabel}
            className={cn(
              'flex h-8 w-full min-w-0 cursor-pointer items-center space-x-0.5 rounded-lg bg-components-input-bg-normal px-2 text-left system-sm-regular text-components-input-text-filled hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover',
              readOnly && 'cursor-default opacity-60 hover:bg-components-input-bg-normal',
              props.className,
            )}
          >
            <span className="shrink-0 p-px">
              <span
                className="i-ri-calendar-line block size-3.5 text-text-tertiary"
                aria-hidden="true"
              />
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate px-1',
                !date && 'text-components-input-text-placeholder',
                date && 'pr-5',
              )}
            >
              {displayValue || resolvedPlaceholder}
            </span>
          </button>
          {date && !readOnly && (
            <button
              type="button"
              aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
              className="pointer-events-none absolute top-1/2 right-2 z-1 flex size-4 -translate-y-1/2 items-center justify-center rounded border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-text-tertiary opacity-0 shadow-xs group-focus-within/date-trigger:pointer-events-auto group-focus-within/date-trigger:opacity-100 group-hover/date-trigger:pointer-events-auto group-hover/date-trigger:opacity-100 hover:bg-components-button-secondary-bg-hover hover:text-text-secondary [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
              onClick={(event) => {
                handleClear(event)
                onChange('')
              }}
            >
              <span className="i-ri-close-circle-fill size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )
    },
    [displayFormat, locale, onChange, readOnly, resolvedPlaceholder, t],
  )

  return (
    <DatePicker
      disabled={readOnly}
      value={parsedValue}
      timezone={timezone}
      onChange={(date) => onChange(date?.format(DATE_FMT) ?? '')}
      onClear={noop}
      renderTrigger={renderTrigger}
      triggerWrapClassName="w-full min-w-0"
      needTimePicker={false}
      noConfirm
    />
  )
}

export default ToolDatePicker
