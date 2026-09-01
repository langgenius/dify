'use client'

import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import type { DatePickerProps, TriggerProps } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { formatToLocalTime } from '@/utils/format'
import DatePicker from '../date-picker'

type DateRangePickerProps = Readonly<{
  start?: Dayjs
  end?: Dayjs
  timezone?: string
  displayFormat?: string
  startPlaceholder?: string
  endPlaceholder?: string
  onStartChange: (date?: Dayjs) => void
  onEndChange: (date?: Dayjs) => void
  clearable?: boolean
  disabled?: boolean
  getIsStartDateDisabled?: DatePickerProps['getIsDateDisabled']
  getIsEndDateDisabled?: DatePickerProps['getIsDateDisabled']
  className?: string
}>

const DateRangePicker: FC<DateRangePickerProps> = ({
  start,
  end,
  timezone,
  displayFormat = 'MMM D',
  startPlaceholder,
  endPlaceholder,
  onStartChange,
  onEndChange,
  clearable = false,
  disabled = false,
  getIsStartDateDisabled,
  getIsEndDateDisabled,
  className,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()

  const renderDate = (
    placeholder: string | undefined,
    onChange: (date?: Dayjs) => void,
  ): NonNullable<DatePickerProps['renderTrigger']> => {
    return (props, _state, { value, handleClear, handleClickTrigger }: TriggerProps) => {
      const displayValue = value ? formatToLocalTime(value, locale, displayFormat) : ''
      const triggerLabel = placeholder
        ? `${placeholder}${displayValue ? `: ${displayValue}` : ''}`
        : displayValue

      return (
        <div
          {...props}
          aria-disabled={disabled || undefined}
          aria-label={triggerLabel}
          className={cn(
            'group/date-trigger relative flex h-7 min-w-0 cursor-pointer items-center rounded-lg px-1 system-sm-regular text-components-input-text-filled hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
            disabled && 'cursor-default hover:bg-transparent',
            props.className,
          )}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            handleClickTrigger(event)
            props.onClick?.(event)
          }}
          onKeyDown={(event) => {
            if (disabled) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            props.onKeyDown?.(event)
          }}
        >
          <span className={cn('truncate', !value && 'text-components-input-text-placeholder')}>
            {displayValue || placeholder}
          </span>
          {clearable && value && !disabled && (
            <button
              type="button"
              aria-label={
                placeholder
                  ? `${placeholder}: ${t(($) => $['operation.clear'], { ns: 'common' })}`
                  : t(($) => $['operation.clear'], { ns: 'common' })
              }
              className="pointer-events-none absolute top-1/2 right-1 z-[1] flex size-4 -translate-y-1/2 items-center justify-center rounded border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-text-tertiary opacity-0 shadow-xs group-focus-within/date-trigger:pointer-events-auto group-focus-within/date-trigger:opacity-100 group-hover/date-trigger:pointer-events-auto group-hover/date-trigger:opacity-100 hover:bg-components-button-secondary-bg-hover hover:text-text-secondary [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
              onClick={(event) => {
                handleClear(event)
                onChange(undefined)
              }}
            >
              <span className="i-ri-close-circle-fill size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )
    }
  }

  return (
    <div
      className={cn(
        'flex h-8 min-w-0 items-center space-x-0.5 rounded-lg bg-components-input-bg-normal px-2',
        disabled && 'opacity-60',
        className,
      )}
    >
      <div className="shrink-0 p-px">
        <span className="i-ri-calendar-line block size-3.5 text-text-tertiary" aria-hidden="true" />
      </div>
      <DatePicker
        value={start}
        timezone={timezone}
        onChange={onStartChange}
        onClear={noop}
        renderTrigger={renderDate(startPlaceholder, onStartChange)}
        triggerWrapClassName="min-w-0"
        needTimePicker={false}
        noConfirm
        getIsDateDisabled={getIsStartDateDisabled}
      />
      <span className="shrink-0 system-sm-regular text-text-tertiary" aria-hidden="true">
        -
      </span>
      <DatePicker
        value={end}
        timezone={timezone}
        onChange={onEndChange}
        onClear={noop}
        renderTrigger={renderDate(endPlaceholder, onEndChange)}
        triggerWrapClassName="min-w-0"
        needTimePicker={false}
        noConfirm
        getIsDateDisabled={getIsEndDateDisabled}
      />
    </div>
  )
}

export default React.memo(DateRangePicker)
