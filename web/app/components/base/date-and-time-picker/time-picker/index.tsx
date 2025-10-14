import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { Period } from '../types'
import type { TimePickerProps } from '../types'
import dayjs, {
  getDateWithTimezone,
  getHourIn12Hour,
  isDayjsObject,
  toDayjs,
} from '../utils/dayjs'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Footer from './footer'
import Options from './options'
import Header from './header'
import { useTranslation } from 'react-i18next'
import { RiCloseCircleFill, RiTimeLine } from '@remixicon/react'
import cn from '@/utils/classnames'

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
}: TimePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitial = useRef(true)

  // Initialize selectedTime
  const [selectedTime, setSelectedTime] = useState(() => {
    return toDayjs(value, { timezone })
  })

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node))
        setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Track previous values to avoid unnecessary updates
  const prevValueRef = useRef(value)
  const prevTimezoneRef = useRef(timezone)

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false
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
    if (!timezoneChanged && !valueChanged) return

    if (value !== undefined && value !== null) {
      const dayjsValue = toDayjs(value, { timezone })
      if (!dayjsValue) return

      setSelectedTime(dayjsValue)

      if (timezoneChanged && !valueChanged)
        onChange(dayjsValue)
      return
    }

    setSelectedTime((prev) => {
      if (!isDayjsObject(prev))
        return undefined
      return timezone ? getDateWithTimezone({ date: prev, timezone }) : prev
    })
  }, [timezone, value, onChange])

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      return
    }
    setIsOpen(true)

    if (value) {
      const dayjsValue = toDayjs(value, { timezone })
      const needsUpdate = dayjsValue && (
        !selectedTime
        || !isDayjsObject(selectedTime)
        || !dayjsValue.isSame(selectedTime, 'minute')
      )
      if (needsUpdate) setSelectedTime(dayjsValue)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedTime(undefined)
    if (!isOpen)
      onClear()
  }

  const handleTimeSelect = (hour: string, minute: string, period: Period) => {
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
  }

  const getSafeTimeObject = useCallback(() => {
    if (isDayjsObject(selectedTime))
      return selectedTime
    return (timezone ? getDateWithTimezone({ timezone }) : dayjs()).startOf('day')
  }, [selectedTime, timezone])

  const handleSelectHour = useCallback((hour: string) => {
    const time = getSafeTimeObject()
    handleTimeSelect(hour, time.minute().toString().padStart(2, '0'), time.format('A') as Period)
  }, [getSafeTimeObject])

  const handleSelectMinute = useCallback((minute: string) => {
    const time = getSafeTimeObject()
    handleTimeSelect(getHourIn12Hour(time).toString().padStart(2, '0'), minute, time.format('A') as Period)
  }, [getSafeTimeObject])

  const handleSelectPeriod = useCallback((period: Period) => {
    const time = getSafeTimeObject()
    handleTimeSelect(getHourIn12Hour(time).toString().padStart(2, '0'), time.minute().toString().padStart(2, '0'), period)
  }, [getSafeTimeObject])

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
    if (!timeValue) return ''

    const dayjsValue = toDayjs(timeValue, { timezone })
    return dayjsValue?.format(timeFormat) || ''
  }, [timezone])

  const displayValue = formatTimeValue(value)

  const placeholderDate = isOpen && isDayjsObject(selectedTime)
    ? selectedTime.format(timeFormat)
    : (placeholder || t('time.defaultPlaceholder'))

  const inputElem = (
    <input
      className='system-xs-regular flex-1 cursor-pointer appearance-none truncate bg-transparent p-1
            text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder'
      readOnly
      value={isOpen ? '' : displayValue}
      placeholder={placeholderDate}
    />
  )
  return (
    <PortalToFollowElem
      open={isOpen}
      onOpenChange={setIsOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger>
        {renderTrigger ? (renderTrigger({
          inputElem,
          onClick: handleClickTrigger,
          isOpen,
        })) : (
          <div
            className='group flex w-[252px] cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt'
            onClick={handleClickTrigger}
          >
            {inputElem}
            <RiTimeLine className={cn(
              'h-4 w-4 shrink-0 text-text-quaternary',
              isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary',
              (displayValue || (isOpen && selectedTime)) && 'group-hover:hidden',
            )} />
            <RiCloseCircleFill
              className={cn(
                'hidden h-4 w-4 shrink-0 text-text-quaternary',
                (displayValue || (isOpen && selectedTime)) && 'hover:text-text-secondary group-hover:inline-block',
              )}
              role='button'
              aria-label={t('common.operation.clear')}
              onClick={handleClear}
            />
          </div>
        )}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn('z-50', popupClassName)}>
        <div className='mt-1 w-[252px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5'>
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
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default TimePicker
