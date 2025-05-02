import React, { useCallback, useEffect, useRef, useState } from 'react'
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

const TimePicker = ({
  value,
  timezone,
  placeholder,
  onChange,
  onClear,
  renderTrigger,
}: TimePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitial = useRef(true)
  const [selectedTime, setSelectedTime] = useState(value ? getDateWithTimezone({ timezone, date: value }) : undefined)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node))
        setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false
      return
    }
    if (value) {
      const newValue = getDateWithTimezone({ date: value, timezone })
      setSelectedTime(newValue)
      onChange(newValue)
    }
    else {
      setSelectedTime(prev => prev ? getDateWithTimezone({ date: prev, timezone }) : undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone])

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      return
    }
    setIsOpen(true)
    if (value)
      setSelectedTime(value)
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

  const handleSelectHour = useCallback((hour: string) => {
    const time = selectedTime || dayjs().startOf('day')
    handleTimeSelect(hour, time.minute().toString().padStart(2, '0'), time.format('A') as Period)
  }, [selectedTime])

  const handleSelectMinute = useCallback((minute: string) => {
    const time = selectedTime || dayjs().startOf('day')
    handleTimeSelect(getHourIn12Hour(time).toString().padStart(2, '0'), minute, time.format('A') as Period)
  }, [selectedTime])

  const handleSelectPeriod = useCallback((period: Period) => {
    const time = selectedTime || dayjs().startOf('day')
    handleTimeSelect(getHourIn12Hour(time).toString().padStart(2, '0'), time.minute().toString().padStart(2, '0'), period)
  }, [selectedTime])

  const handleSelectCurrentTime = useCallback(() => {
    const newDate = getDateWithTimezone({ timezone })
    setSelectedTime(newDate)
    onChange(newDate)
    setIsOpen(false)
  }, [onChange, timezone])

  const handleConfirm = useCallback(() => {
    onChange(selectedTime)
    setIsOpen(false)
  }, [onChange, selectedTime])

  const timeFormat = 'hh:mm A'
  const displayValue = value?.format(timeFormat) || ''
  const placeholderDate = isOpen && selectedTime ? selectedTime.format(timeFormat) : (placeholder || t('time.defaultPlaceholder'))

  return (
    <PortalToFollowElem
      open={isOpen}
      onOpenChange={setIsOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger>
        {renderTrigger ? (renderTrigger()) : (
          <div
            className='group flex w-[252px] cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt'
            onClick={handleClickTrigger}
          >
            <input
              className='system-xs-regular flex-1 cursor-pointer appearance-none truncate bg-transparent p-1
            text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder'
              readOnly
              value={isOpen ? '' : displayValue}
              placeholder={placeholderDate}
            />
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
      <PortalToFollowElemContent className='z-50'>
        <div className='mt-1 w-[252px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5'>
          {/* Header */}
          <Header />

          {/* Time Options */}
          <Options
            selectedTime={selectedTime}
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
