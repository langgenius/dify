import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RiCalendarLine, RiCloseCircleFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import type { DatePickerProps, Period } from '../types'
import { ViewType } from '../types'
import type { Dayjs } from 'dayjs'
import dayjs, {
  clearMonthMapCache,
  cloneTime,
  getDateWithTimezone,
  getDaysInMonth,
  getHourIn12Hour,
} from '../utils/dayjs'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import DatePickerHeader from './header'
import Calendar from '../calendar'
import DatePickerFooter from './footer'
import YearAndMonthPickerHeader from '../year-and-month-picker/header'
import YearAndMonthPickerOptions from '../year-and-month-picker/options'
import YearAndMonthPickerFooter from '../year-and-month-picker/footer'
import TimePickerHeader from '../time-picker/header'
import TimePickerOptions from '../time-picker/options'
import { useTranslation } from 'react-i18next'

const DatePicker = ({
  value,
  timezone,
  onChange,
  onClear,
  placeholder,
  needTimePicker = true,
  renderTrigger,
  triggerWrapClassName,
  popupZIndexClassname = 'z-[11]',
}: DatePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState(ViewType.date)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitial = useRef(true)
  const inputValue = useRef(value ? value.tz(timezone) : undefined).current
  const defaultValue = useRef(getDateWithTimezone({ timezone })).current

  const [currentDate, setCurrentDate] = useState(inputValue || defaultValue)
  const [selectedDate, setSelectedDate] = useState(inputValue)

  const [selectedMonth, setSelectedMonth] = useState((inputValue || defaultValue).month())
  const [selectedYear, setSelectedYear] = useState((inputValue || defaultValue).year())

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setView(ViewType.date)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false
      return
    }
    clearMonthMapCache()
    if (value) {
      const newValue = getDateWithTimezone({ date: value, timezone })
      setCurrentDate(newValue)
      setSelectedDate(newValue)
      onChange(newValue)
    }
    else {
      setCurrentDate(prev => getDateWithTimezone({ date: prev, timezone }))
      setSelectedDate(prev => prev ? getDateWithTimezone({ date: prev, timezone }) : undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone])

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      return
    }
    setView(ViewType.date)
    setIsOpen(true)
    if (value) {
      setCurrentDate(value)
      setSelectedDate(value)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedDate(undefined)
    if (!isOpen)
      onClear()
  }

  const days = useMemo(() => {
    return getDaysInMonth(currentDate)
  }, [currentDate])

  const handleClickNextMonth = useCallback(() => {
    setCurrentDate(currentDate.clone().add(1, 'month'))
  }, [currentDate])

  const handleClickPrevMonth = useCallback(() => {
    setCurrentDate(currentDate.clone().subtract(1, 'month'))
  }, [currentDate])

  const handleDateSelect = useCallback((day: Dayjs) => {
    const newDate = cloneTime(day, selectedDate || getDateWithTimezone({ timezone }))
    setCurrentDate(newDate)
    setSelectedDate(newDate)
  }, [selectedDate, timezone])

  const handleSelectCurrentDate = () => {
    const newDate = getDateWithTimezone({ timezone })
    setCurrentDate(newDate)
    setSelectedDate(newDate)
    onChange(newDate)
    setIsOpen(false)
  }

  const handleConfirmDate = () => {
    // debugger
    onChange(selectedDate ? selectedDate.tz(timezone) : undefined)
    setIsOpen(false)
  }

  const handleClickTimePicker = () => {
    if (view === ViewType.date) {
      setView(ViewType.time)
      return
    }
    if (view === ViewType.time)
      setView(ViewType.date)
  }

  const handleTimeSelect = (hour: string, minute: string, period: Period) => {
    const newTime = cloneTime(dayjs(), dayjs(`1/1/2000 ${hour}:${minute} ${period}`))
    setSelectedDate((prev) => {
      return prev ? cloneTime(prev, newTime) : newTime
    })
  }

  const handleSelectHour = useCallback((hour: string) => {
    const selectedTime = selectedDate || getDateWithTimezone({ timezone })
    handleTimeSelect(hour, selectedTime.minute().toString().padStart(2, '0'), selectedTime.format('A') as Period)
  }, [selectedDate, timezone])

  const handleSelectMinute = useCallback((minute: string) => {
    const selectedTime = selectedDate || getDateWithTimezone({ timezone })
    handleTimeSelect(getHourIn12Hour(selectedTime).toString().padStart(2, '0'), minute, selectedTime.format('A') as Period)
  }, [selectedDate, timezone])

  const handleSelectPeriod = useCallback((period: Period) => {
    const selectedTime = selectedDate || getDateWithTimezone({ timezone })
    handleTimeSelect(getHourIn12Hour(selectedTime).toString().padStart(2, '0'), selectedTime.minute().toString().padStart(2, '0'), period)
  }, [selectedDate, timezone])

  const handleOpenYearMonthPicker = () => {
    setSelectedMonth(currentDate.month())
    setSelectedYear(currentDate.year())
    setView(ViewType.yearMonth)
  }

  const handleCloseYearMonthPicker = useCallback(() => {
    setView(ViewType.date)
  }, [])

  const handleMonthSelect = useCallback((month: number) => {
    setSelectedMonth(month)
  }, [])

  const handleYearSelect = useCallback((year: number) => {
    setSelectedYear(year)
  }, [])

  const handleYearMonthCancel = useCallback(() => {
    setView(ViewType.date)
  }, [])

  const handleYearMonthConfirm = () => {
    setCurrentDate(prev => prev.clone().month(selectedMonth).year(selectedYear))
    setView(ViewType.date)
  }

  const timeFormat = needTimePicker ? 'MMMM D, YYYY hh:mm A' : 'MMMM D, YYYY'
  const displayValue = value?.format(timeFormat) || ''
  const displayTime = selectedDate?.format('hh:mm A') || '--:-- --'
  const placeholderDate = isOpen && selectedDate ? selectedDate.format(timeFormat) : (placeholder || t('time.defaultPlaceholder'))

  return (
    <PortalToFollowElem
      open={isOpen}
      onOpenChange={setIsOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger className={triggerWrapClassName}>
        {renderTrigger ? (renderTrigger({
          value,
          selectedDate,
          isOpen,
          handleClear,
          handleClickTrigger,
        })) : (
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
            <RiCalendarLine className={cn(
              'h-4 w-4 shrink-0 text-text-quaternary',
              isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary',
              (displayValue || (isOpen && selectedDate)) && 'group-hover:hidden',
            )} />
            <RiCloseCircleFill
              className={cn(
                'hidden h-4 w-4 shrink-0 text-text-quaternary',
                (displayValue || (isOpen && selectedDate)) && 'hover:text-text-secondary group-hover:inline-block',
              )}
              onClick={handleClear}
            />
          </div>
        )}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={popupZIndexClassname}>
        <div className='mt-1 w-[252px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5'>
          {/* Header */}
          {view === ViewType.date ? (
            <DatePickerHeader
              handleOpenYearMonthPicker={handleOpenYearMonthPicker}
              currentDate={currentDate}
              onClickNextMonth={handleClickNextMonth}
              onClickPrevMonth={handleClickPrevMonth}
            />
          ) : view === ViewType.yearMonth ? (
            <YearAndMonthPickerHeader
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              onClick={handleCloseYearMonthPicker}
            />
          ) : (
            <TimePickerHeader />
          )}

          {/* Content */}
          {
            view === ViewType.date ? (
              <Calendar
                days={days}
                selectedDate={selectedDate}
                onDateClick={handleDateSelect}
              />
            ) : view === ViewType.yearMonth ? (
              <YearAndMonthPickerOptions
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
                handleMonthSelect={handleMonthSelect}
                handleYearSelect={handleYearSelect}
              />
            ) : (
              <TimePickerOptions
                selectedTime={selectedDate}
                handleSelectHour={handleSelectHour}
                handleSelectMinute={handleSelectMinute}
                handleSelectPeriod={handleSelectPeriod}
              />
            )
          }

          {/* Footer */}
          {
            [ViewType.date, ViewType.time].includes(view) ? (
              <DatePickerFooter
                needTimePicker={needTimePicker}
                displayTime={displayTime}
                view={view}
                handleClickTimePicker={handleClickTimePicker}
                handleSelectCurrentDate={handleSelectCurrentDate}
                handleConfirmDate={handleConfirmDate}
              />
            ) : (
              <YearAndMonthPickerFooter
                handleYearMonthCancel={handleYearMonthCancel}
                handleYearMonthConfirm={handleYearMonthConfirm}
              />
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default DatePicker
