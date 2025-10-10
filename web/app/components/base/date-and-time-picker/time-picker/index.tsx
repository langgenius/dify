import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import type { Period, TimePickerProps } from '../types'
import dayjs, { cloneTime, getDateWithTimezone, getHourIn12Hour } from '../utils/dayjs'
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

// Helper function: Check if a value is a valid dayjs object
const isDayjsObject = (value: any): value is Dayjs => {
  return value && typeof value === 'object' && typeof value.format === 'function'
}

// Helper function: Convert string or dayjs object to dayjs object
const toDayjs = (value: string | Dayjs | undefined): Dayjs | undefined => {
  if (!value) return undefined

  if (typeof value === 'string') {
    const parsedDate = dayjs(value)
    return parsedDate.isValid() ? parsedDate : undefined
  }

  return value
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
    const dayjsValue = toDayjs(value)
    return dayjsValue ? getDateWithTimezone({ timezone, date: dayjsValue }) : undefined
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

    if (value) {
      // Process value using helper function
      const dayjsValue = toDayjs(value)
      if (!dayjsValue) return

      const newValue = getDateWithTimezone({ date: dayjsValue, timezone })

      // Only update internal state to avoid triggering extra onChange calls
      setSelectedTime(newValue)

      // Only call onChange when timezone changes but value doesn't
      if (timezoneChanged && !valueChanged) {
        // Use setTimeout to avoid potential render loops
        setTimeout(() => {
          onChange(newValue)
        }, 0)
      }
    }
    else {
      setSelectedTime(prev => prev ? getDateWithTimezone({ date: prev, timezone }) : undefined)
    }
  }, [timezone, value])

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      return
    }
    setIsOpen(true)

    if (value) {
      const dayjsValue = toDayjs(value)
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
    const newTime = cloneTime(dayjs(), dayjs(`1/1/2000 ${hour}:${minute} ${period}`))
    setSelectedTime((prev) => {
      return prev ? cloneTime(prev, newTime) : newTime
    })
  }

  const getSafeTimeObject = useCallback(() => {
    return isDayjsObject(selectedTime) ? selectedTime : dayjs().startOf('day')
  }, [selectedTime])

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
    setTimeout(() => {
      onChange(newDate)
    }, 0)
    setIsOpen(false)
  }, [timezone])

  const handleConfirm = useCallback(() => {
    if (isDayjsObject(selectedTime)) {
      const timeVal = selectedTime
      setTimeout(() => {
        onChange(timeVal)
      }, 0)
    }
    setIsOpen(false)
  }, [selectedTime])

  const timeFormat = 'hh:mm A'

  const formatTimeValue = useCallback((timeValue: string | Dayjs | undefined): string => {
    if (!timeValue) return ''

    const dayjsValue = toDayjs(timeValue)
    return dayjsValue?.format(timeFormat) || ''
  }, [])

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
