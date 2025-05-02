import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { RiCalendarLine, RiCloseCircleFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import type { DatePickerProps, Period } from '../types'
import { ViewType } from '../types'
import { cloneTime, getDaysInMonth, getHourIn12Hour } from '../utils'
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
  onChange,
  onClear,
  placeholder,
  needTimePicker = true,
  renderTrigger,
}: DatePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState(ViewType.date)
  const containerRef = useRef<HTMLDivElement>(null)

  const [currentDate, setCurrentDate] = useState(value || dayjs())
  const [selectedDate, setSelectedDate] = useState(value)

  const [selectedMonth, setSelectedMonth] = useState((value || dayjs()).month())
  const [selectedYear, setSelectedYear] = useState((value || dayjs()).year())

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

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      return
    }
    setView(ViewType.date)
    setIsOpen(true)
  }

  const handleClear = (e: React.MouseEvent) => {
    const newDate = dayjs()
    e.stopPropagation()
    setSelectedDate(undefined)
    setCurrentDate(prev => prev || newDate)
    setSelectedMonth(prev => prev || newDate.month())
    setSelectedYear(prev => prev || newDate.year())
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
    const newDate = cloneTime(day, selectedDate || dayjs())
    setCurrentDate(newDate)
    setSelectedDate(newDate)
  }, [selectedDate])

  const handleSelectCurrentDate = () => {
    const newDate = dayjs()
    setCurrentDate(newDate)
    setSelectedDate(newDate)
    onChange(newDate)
    setIsOpen(false)
  }

  const handleConfirmDate = () => {
    onChange(selectedDate)
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
    const selectedTime = selectedDate || dayjs()
    handleTimeSelect(hour, selectedTime.minute().toString().padStart(2, '0'), selectedTime.format('A') as Period)
  }, [selectedDate])

  const handleSelectMinute = useCallback((minute: string) => {
    const selectedTime = selectedDate || dayjs()
    handleTimeSelect(getHourIn12Hour(selectedTime).toString().padStart(2, '0'), minute, selectedTime.format('A') as Period)
  }, [selectedDate])

  const handleSelectPeriod = useCallback((period: Period) => {
    const selectedTime = selectedDate || dayjs()
    handleTimeSelect(getHourIn12Hour(selectedTime).toString().padStart(2, '0'), selectedTime.minute().toString().padStart(2, '0'), period)
  }, [selectedDate])

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
    setCurrentDate((prev) => {
      return prev ? prev.clone().month(selectedMonth).year(selectedYear) : dayjs().month(selectedMonth).year(selectedYear)
    })
    setView(ViewType.date)
  }

  const timeFormat = needTimePicker ? 'MMMM D, YYYY hh:mm A' : 'MMMM D, YYYY'
  const displayValue = value?.format(timeFormat) || ''
  const displayTime = (selectedDate || dayjs().startOf('day')).format('hh:mm A')
  const placeholderDate = isOpen && selectedDate ? selectedDate.format(timeFormat) : (placeholder || t('time.defaultPlaceholder'))

  return (
    <PortalToFollowElem
      open={isOpen}
      onOpenChange={setIsOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger>
        {renderTrigger ? (renderTrigger({
          value,
          selectedDate,
          isOpen,
          handleClear,
          handleClickTrigger,
        })) : (
          <div
            className='w-[252px] flex items-center gap-x-0.5 rounded-lg px-2 py-1 bg-components-input-bg-normal cursor-pointer group hover:bg-state-base-hover-alt'
            onClick={handleClickTrigger}
          >
            <input
              className='flex-1 p-1 bg-transparent text-components-input-text-filled placeholder:text-components-input-text-placeholder truncate system-xs-regular
            outline-none appearance-none cursor-pointer'
              readOnly
              value={isOpen ? '' : displayValue}
              placeholder={placeholderDate}
            />
            <RiCalendarLine className={cn(
              'shrink-0 w-4 h-4 text-text-quaternary',
              isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary',
              (displayValue || (isOpen && selectedDate)) && 'group-hover:hidden',
            )} />
            <RiCloseCircleFill
              className={cn(
                'hidden shrink-0 w-4 h-4 text-text-quaternary',
                (displayValue || (isOpen && selectedDate)) && 'group-hover:inline-block hover:text-text-secondary',
              )}
              onClick={handleClear}
            />
          </div>
        )}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='w-[252px] mt-1 bg-components-panel-bg rounded-xl shadow-lg shadow-shadow-shadow-5 border-[0.5px] border-components-panel-border'>
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
