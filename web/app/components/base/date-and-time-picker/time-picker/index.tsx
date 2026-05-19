import type { Dayjs } from 'dayjs'
import type { TimePickerProps } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TimezoneLabel from '@/app/components/base/timezone-label'
import { Period } from '../types'
import dayjs, {
  getDateWithTimezone,
  getHourIn12Hour,
  isDayjsObject,
  toDayjs,
} from '../utils/dayjs'
import Footer from './footer'
import Header from './header'
import Options from './options'

const to24Hour = (hour12: string, period: Period) => {
  const normalized = Number.parseInt(hour12, 10) % 12
  return period === Period.PM ? normalized + 12 : normalized
}

const TimePicker = ({
  value,
  timezone,
  placeholder,
  onChange,
  onClear,
  renderTrigger,
  title,
  minuteFilter,
  popupClassName,
  notClearable = false,
  triggerFullWidth = false,
  showTimezone = false,
  placement = 'bottom-start',
}: TimePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const isInitialRef = useRef(true)

  // Initialize selectedTime
  const [selectedTime, setSelectedTime] = useState(() => {
    return toDayjs(value, { timezone })
  })

  // Track previous values to avoid unnecessary updates
  const prevValueRef = useRef(value)
  const prevTimezoneRef = useRef(timezone)

  useEffect(() => {
    if (isInitialRef.current) {
      isInitialRef.current = false
      // Save initial values on first render
      prevValueRef.current = value
      prevTimezoneRef.current = timezone
      return
    }

    // Only update when timezone changes but value doesn't
    const valueChanged = prevValueRef.current !== value
    const timezoneChanged = prevTimezoneRef.current !== timezone

    // Update reference values
    prevValueRef.current = value
    prevTimezoneRef.current = timezone

    // Skip if neither timezone changed nor value changed
    if (!timezoneChanged && !valueChanged)
      return

    if (value !== undefined && value !== null) {
      const dayjsValue = toDayjs(value, { timezone })
      if (!dayjsValue)
        return

      // eslint-disable-next-line react/set-state-in-effect -- value/timezone changes intentionally resync the internal selected time.
      setSelectedTime(dayjsValue)

      if (timezoneChanged && !valueChanged)
        onChange(dayjsValue)
      return
    }

    // eslint-disable-next-line react/set-state-in-effect -- value/timezone changes intentionally resync the internal selected time.
    setSelectedTime((prev) => {
      if (!isDayjsObject(prev))
        return undefined
      return timezone ? getDateWithTimezone({ date: prev, timezone }) : prev
    })
  }, [timezone, value, onChange])

  const syncSelectedTimeFromValue = useCallback(() => {
    if (!value)
      return

    const dayjsValue = toDayjs(value, { timezone })
    const needsUpdate = dayjsValue && (
      !selectedTime
      || !isDayjsObject(selectedTime)
      || !dayjsValue.isSame(selectedTime, 'minute')
    )
    if (needsUpdate)
      setSelectedTime(dayjsValue)
  }, [selectedTime, timezone, value])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen)
    if (nextOpen)
      syncSelectedTimeFromValue()
  }, [syncSelectedTimeFromValue])

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    handleOpenChange(!isOpen)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedTime(undefined)
    if (!isOpen)
      onClear()
  }

  const handleTimeSelect = useCallback((hour: string, minute: string, period: Period) => {
    const periodAdjustedHour = to24Hour(hour, period)
    const nextMinute = Number.parseInt(minute, 10)
    setSelectedTime((prev) => {
      const reference = isDayjsObject(prev)
        ? prev
        : (timezone ? getDateWithTimezone({ timezone }) : dayjs()).startOf('minute')
      return reference
        .set('hour', periodAdjustedHour)
        .set('minute', nextMinute)
        .set('second', 0)
        .set('millisecond', 0)
    })
  }, [timezone])

  const getSafeTimeObject = useCallback(() => {
    if (isDayjsObject(selectedTime))
      return selectedTime
    return (timezone ? getDateWithTimezone({ timezone }) : dayjs()).startOf('day')
  }, [selectedTime, timezone])

  const handleSelectHour = useCallback((hour: string) => {
    const time = getSafeTimeObject()
    handleTimeSelect(hour, time.minute().toString().padStart(2, '0'), time.format('A') as Period)
  }, [getSafeTimeObject, handleTimeSelect])

  const handleSelectMinute = useCallback((minute: string) => {
    const time = getSafeTimeObject()
    handleTimeSelect(getHourIn12Hour(time).toString().padStart(2, '0'), minute, time.format('A') as Period)
  }, [getSafeTimeObject, handleTimeSelect])

  const handleSelectPeriod = useCallback((period: Period) => {
    const time = getSafeTimeObject()
    handleTimeSelect(getHourIn12Hour(time).toString().padStart(2, '0'), time.minute().toString().padStart(2, '0'), period)
  }, [getSafeTimeObject, handleTimeSelect])

  const handleSelectCurrentTime = useCallback(() => {
    const newDate = getDateWithTimezone({ timezone })
    setSelectedTime(newDate)
    onChange(newDate)
    setIsOpen(false)
  }, [timezone, onChange])

  const handleConfirm = useCallback(() => {
    const valueToEmit = isDayjsObject(selectedTime) ? selectedTime : undefined
    onChange(valueToEmit)
    setIsOpen(false)
  }, [selectedTime, onChange])

  const timeFormat = 'hh:mm A'

  const formatTimeValue = useCallback((timeValue: string | Dayjs | undefined): string => {
    if (!timeValue)
      return ''

    const dayjsValue = toDayjs(timeValue, { timezone })
    return dayjsValue?.format(timeFormat) || ''
  }, [timezone])

  const displayValue = formatTimeValue(value)

  const placeholderDate = isOpen && isDayjsObject(selectedTime)
    ? selectedTime.format(timeFormat)
    : (placeholder || t('defaultPlaceholder', { ns: 'time' }))

  const inputElem = (
    <input
      className="flex-1 cursor-pointer appearance-none truncate bg-transparent p-1 system-xs-regular text-components-input-text-filled
            outline-hidden select-none placeholder:text-components-input-text-placeholder"
      readOnly
      value={isOpen ? '' : displayValue}
      placeholder={placeholderDate}
    />
  )
  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        nativeButton={false}
        className={triggerFullWidth ? 'flex! w-full' : undefined}
        render={renderTrigger
          ? renderTrigger({
              inputElem,
              onClick: handleClickTrigger,
              isOpen,
            })
          : (
              <div
                className={cn(
                  'group flex cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt',
                  triggerFullWidth ? 'w-full min-w-0' : 'w-[252px]',
                )}
                onClick={handleClickTrigger}
                data-testid="time-picker-trigger"
              >
                {inputElem}
                {showTimezone && timezone && (
                  <TimezoneLabel timezone={timezone} inline className="shrink-0 text-xs select-none" />
                )}
                <span className={cn('i-ri-time-line h-4 w-4 shrink-0 text-text-quaternary', isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary', (displayValue || (isOpen && selectedTime)) && !notClearable && 'group-hover:hidden')} />
                <button
                  type="button"
                  className={cn('hidden h-4 w-4 shrink-0 border-none bg-transparent p-0 text-text-quaternary hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden', (displayValue || (isOpen && selectedTime)) && !notClearable && 'group-hover:inline-block')}
                  aria-label={t('operation.clear', { ns: 'common' })}
                  onClick={handleClear}
                >
                  <span className="i-ri-close-circle-fill h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
      />
      <PopoverContent
        placement={placement}
        sideOffset={0}
        className={popupClassName}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="mt-1 w-[252px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5">
          {/* Header */}
          <Header title={title} />

          {/* Time Options */}
          <Options
            selectedTime={selectedTime}
            minuteFilter={minuteFilter}
            handleSelectHour={handleSelectHour}
            handleSelectMinute={handleSelectMinute}
            handleSelectPeriod={handleSelectPeriod}
          />

          {/* Footer */}
          <Footer
            handleSelectCurrentTime={handleSelectCurrentTime}
            handleConfirm={handleConfirm}
          />

        </div>
      </PopoverContent>
    </Popover>
  )
}

export default TimePicker
