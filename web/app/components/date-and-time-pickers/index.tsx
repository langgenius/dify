import React, { useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { RiArrowDownSLine, RiArrowUpSLine, RiCalendarLine, RiCloseCircleFill, RiTimeLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '../base/button'
import OptionListItem from './common/option-list-item'
import type { DatePickerProps } from './types'
import { ViewType } from './types'
import Calendar from './calendar'
import { cloneTime, getDaysInMonth } from './utils'

const YEAR_RANGE = 100

function DateTimePicker({
  value,
  onChange,
  onClear,
  placeholder = 'Pick a time...',
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState(ViewType.date)
  const containerRef = useRef<HTMLDivElement>(null)

  const [currentDate, setCurrentDate] = useState(value || dayjs())
  const [selectedDate, setSelectedDate] = useState(value)
  const [candidateDate, setCandidateDate] = useState(value)

  const [selectedTime, setSelectedTime] = useState(value || dayjs())

  const [selectedMonth, setSelectedMonth] = useState((value || dayjs()).month())
  const [selectedYear, setSelectedYear] = useState((value || dayjs()).year())

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const yearOptions = Array.from({ length: 200 }, (_, i) => dayjs().year() - YEAR_RANGE / 2 + i)

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

  const hourOptions = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'))
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'))
  const periodOptions = ['AM', 'PM']

  const handleDateSelect = (day: Dayjs) => {
    const newDate = cloneTime(day, selectedTime)
    setCurrentDate(newDate)
    setSelectedDate(newDate)
    setCandidateDate(newDate)
  }

  const days = useMemo(() => {
    return getDaysInMonth(currentDate)
  }, [currentDate])

  const handleConfirmDate = () => {
    onChange(selectedDate)
    setIsOpen(false)
  }

  const handleSelectCurrentDate = () => {
    setCurrentDate(dayjs())
    setSelectedDate(dayjs())
    setCandidateDate(dayjs())
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentDate(value || dayjs())
    setSelectedDate(value)
    setCandidateDate(value)
    setSelectedTime(value || dayjs())
    setSelectedMonth((value || dayjs()).month())
    setSelectedYear((value || dayjs()).year())
    setIsOpen(true)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedDate(undefined)
    setCandidateDate(undefined)
    setCurrentDate(prev => prev || dayjs())
    setSelectedTime(prev => prev || dayjs())
    setSelectedMonth(prev => prev || dayjs().month())
    setSelectedYear(prev => prev || dayjs().year())
    if (!isOpen)
      onClear()
  }

  const getCurrentHour = () => {
    const hour = selectedTime.hour()
    return hour === 0 ? 12 : hour >= 12 ? hour - 12 : hour
  }

  const handleOpenTimePicker = () => {
    setView(ViewType.time)
  }

  const handleBackToDatePicker = () => {
    setView(ViewType.date)
  }

  const handleSelectCurrentTime = () => {
    setSelectedTime(dayjs())
  }

  const handleTimeSelect = (hour: string, minute: string, period: 'AM' | 'PM') => {
    const newTime = cloneTime(dayjs(), dayjs(`1/1/2000 ${hour}:${minute} ${period}`))
    setSelectedTime((prev) => {
      return prev ? cloneTime(prev, newTime) : newTime
    })
  }

  const handleConfirmTime = () => {
    setCurrentDate((prev) => {
      return prev ? cloneTime(prev, selectedTime) : selectedTime
    })
    setSelectedDate((prev) => {
      return prev ? cloneTime(prev, selectedTime) : selectedTime
    })
    setCandidateDate((prev) => {
      return prev ? cloneTime(prev, selectedTime) : selectedTime
    })
    setView(ViewType.date)
  }

  const handleOpenYearMonthPicker = () => {
    setSelectedMonth(currentDate.month())
    setSelectedYear(currentDate.year())
    setView(ViewType.yearMonth)
  }

  const handleMonthSelect = (month: number) => {
    setSelectedMonth(month)
  }

  const handleYearSelect = (year: number) => {
    setSelectedYear(year)
  }

  const handleYearMonthCancel = () => {
    setView(ViewType.date)
  }

  const handleYearMonthConfirm = () => {
    setCurrentDate((prev) => {
      return prev ? prev.clone().month(selectedMonth).year(selectedYear) : dayjs().month(selectedMonth).year(selectedYear)
    })
    setView(ViewType.date)
  }

  const displayValue = value?.format('MMMM D, YYYY hh:mm A') || ''
  const displayTime = (selectedTime || dayjs()).format('hh:mm A')
  const placeholderDate = isOpen && candidateDate ? candidateDate.format('MMMM D, YYYY hh:mm A') : placeholder

  return (
    <div className='relative w-[252px]' ref={containerRef}>
      {/* Display of Date */}
      <div
        className='w-full flex items-center gap-x-0.5 rounded-lg px-2 py-1 bg-components-input-bg-normal cursor-pointer group hover:bg-state-base-hover-alt'
        onClick={handleOpen}
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

      {isOpen && (
        <div className='absolute z-50 w-[252px] mt-1 bg-components-panel-bg rounded-xl shadow-lg shadow-shadow-shadow-5 border-[0.5px] border-components-panel-border'>
          {
            view === ViewType.date && (
              <>
                {/* Header */}
                <div className='flex items-center mx-2 mt-2'>
                  <div className='flex-1'>
                    <button
                      onClick={handleOpenYearMonthPicker}
                      className='flex items-center gap-x-0.5 px-2 py-1.5 rounded-lg hover:bg-state-base-hover text-text-primary system-md-semibold'
                    >
                      <span>{`${months[currentDate.month()]} ${currentDate.year()}`}</span>
                      <RiArrowDownSLine className='w-4 h-4 text-text-tertiary' />
                    </button>
                  </div>
                  <button
                    onClick={() => setCurrentDate(currentDate.clone().subtract(1, 'month'))}
                    className='p-1.5 hover:bg-state-base-hover rounded-lg'
                  >
                    <RiArrowDownSLine className='w-[18px] h-[18px] text-text-secondary' />
                  </button>
                  <button
                    onClick={() => setCurrentDate(currentDate.clone().add(1, 'month'))}
                    className='p-1.5 hover:bg-state-base-hover rounded-lg'
                  >
                    <RiArrowUpSLine className='w-[18px] h-[18px] text-text-secondary' />
                  </button>
                </div>

                {/* Days Of Week */}
                <Calendar
                  days={days}
                  selectedDate={selectedDate}
                  onDateClick={handleDateSelect}
                />

                {/* Footer */}
                <div className='flex justify-between items-center p-2 border-t-[0.5px] border-divider-regular'>
                  {/* Time Picker */}
                  <button
                    type='button'
                    className='flex items-center rounded-md px-1.5 py-1 gap-x-[1px] border-[0.5px] border-components-button-secondary-border system-xs-medium
                    bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] text-components-button-secondary-accent-text'
                    onClick={handleOpenTimePicker}
                  >
                    <RiTimeLine className='w-3.5 h-3.5' />
                    <span>{displayTime}</span>
                  </button>
                  {/* Now and Confirm */}
                  <div className='flex items-center gap-x-1'>
                    {/* Now */}
                    <button
                      type='button'
                      className='flex items-center justify-center px-1.5 py-1 text-components-button-secondary-accent-text system-xs-medium'
                      onClick={handleSelectCurrentDate}
                    >
                      <span className='px-[3px]'>Now</span>
                    </button>
                    {/* Confirm Button */}
                    <Button
                      variant='primary'
                      size='small'
                      className='w-16 px-1.5 py-1'
                      onClick={handleConfirmDate}
                    >
                      OK
                    </Button>
                  </div>
                </div>
              </>
            )
          }
          {
            view === ViewType.time && (
              <>
                {/* Header */}
                <div className='flex flex-col border-b-[0.5px] border-divider-regular'>
                  {/* Title */}
                  <div className='flex items-center px-2 py-1.5 text-text-primary system-md-semibold'>
                    Pick Time
                  </div>
                </div>

                {/* Time Picker */}
                <div className='grid grid-cols-3 gap-x-1 p-2'>
                  {/* Hour */}
                  <ul className='flex flex-col gap-y-0.5 h-[208px] overflow-y-auto no-scrollbar pb-[184px]'>
                    {
                      hourOptions.map((hour) => {
                        const isSelected = selectedTime.format('hh') === hour
                        return (
                          <OptionListItem
                            key={hour}
                            isSelected={isSelected}
                            onClick={() => {
                              handleTimeSelect(hour, selectedTime.minute().toString().padStart(2, '0'), selectedTime.format('A') as 'AM' | 'PM')
                            }}
                          >
                            {hour}
                          </OptionListItem>
                        )
                      })
                    }
                  </ul>
                  {/* Minute */}
                  <ul className='flex flex-col gap-y-0.5 h-[208px] overflow-y-auto no-scrollbar pb-[184px]'>
                    {
                      minuteOptions.map((minute) => {
                        const isSelected = selectedTime.format('mm') === minute
                        return (
                          <OptionListItem
                            key={minute}
                            isSelected={isSelected}
                            onClick={() => {
                              handleTimeSelect(getCurrentHour().toString().padStart(2, '0'), minute, selectedTime.format('A') as 'AM' | 'PM')
                            }}
                          >
                            {minute}
                          </OptionListItem>
                        )
                      })
                    }
                  </ul>
                  {/* Period */}
                  <ul className='flex flex-col gap-y-0.5 h-[208px] overflow-y-auto no-scrollbar pb-[184px]'>
                    {
                      periodOptions.map((period) => {
                        const isSelected = selectedTime.format('A') === period
                        return (
                          <OptionListItem
                            key={period}
                            isSelected={isSelected}
                            onClick={() => {
                              handleTimeSelect(getCurrentHour().toString().padStart(2, '0'), selectedTime.minute().toString().padStart(2, '0'), period as 'AM' | 'PM')
                            }}
                          >
                            {period}
                          </OptionListItem>
                        )
                      })
                    }
                  </ul>
                </div>

                {/* Footer */}
                <div className='flex justify-between items-center p-2 border-t-[0.5px] border-divider-regular'>
                  {/* Time Picker */}
                  <button
                    type='button'
                    className='flex items-center rounded-md px-1.5 py-1 gap-x-[1px] border-[0.5px] border-components-button-secondary-border system-xs-medium
                    bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] text-components-button-secondary-accent-text'
                    onClick={handleBackToDatePicker}
                  >
                    <RiCalendarLine className='w-3.5 h-3.5' />
                    <span>Pick Date</span>
                  </button>
                  {/* Now and Confirm */}
                  <div className='flex items-center gap-x-1'>
                    {/* Now */}
                    <button
                      type='button'
                      className='flex items-center justify-center px-1.5 py-1 text-components-button-secondary-accent-text system-xs-medium'
                      onClick={handleSelectCurrentTime}
                    >
                      <span className='px-[3px]'>Now</span>
                    </button>
                    {/* Confirm Button */}
                    <Button
                      variant='primary'
                      size='small'
                      className='w-16 px-1.5 py-1'
                      onClick={handleConfirmTime}
                    >
                      OK
                    </Button>
                  </div>
                </div>
              </>
            )
          }
          {
            view === ViewType.yearMonth && (
              <>
                {/* Header */}
                <div className='flex p-2 pb-1 border-b-[0.5px] border-divider-regular'>
                  {/* Year and Month */}
                  <button
                    onClick={() => setView(ViewType.yearMonth)}
                    className='flex items-center gap-x-0.5 px-2 py-1.5 rounded-lg hover:bg-state-base-hover text-text-primary system-md-semibold'
                  >
                    <span>{`${months[selectedMonth]} ${selectedYear}`}</span>
                    <RiArrowUpSLine className='w-4 h-4 text-text-tertiary' />
                  </button>
                </div>

                {/* Year and Month Picker */}
                <div className='grid grid-cols-2 gap-x-1 p-2'>
                  {/* Month Picker */}
                  <ul className='flex flex-col gap-y-0.5 h-[208px] overflow-y-auto no-scrollbar pb-[184px]'>
                    {
                      months.map((month, index) => {
                        const isSelected = selectedMonth === index
                        return (
                          <OptionListItem
                            key={month}
                            isSelected={isSelected}
                            onClick={() => {
                              handleMonthSelect(index)
                            }}
                          >
                            {month}
                          </OptionListItem>
                        )
                      })
                    }
                  </ul>
                  {/* Year Picker */}
                  <ul className='flex flex-col gap-y-0.5 h-[208px] overflow-y-auto no-scrollbar pb-[184px]'>
                    {
                      yearOptions.map((year) => {
                        const isSelected = selectedYear === year
                        return (
                          <OptionListItem
                            key={year}
                            isSelected={isSelected}
                            onClick={() => {
                              handleYearSelect(year)
                            }}
                          >
                            {year}
                          </OptionListItem>
                        )
                      })
                    }
                  </ul>
                </div>

                {/* Footer */}
                <div className='grid grid-cols-2 gap-x-1 p-2'>
                  <Button size='small' onClick={handleYearMonthCancel}>
                    Cancel
                  </Button>
                  <Button variant='primary' size='small' onClick={handleYearMonthConfirm}>
                    OK
                  </Button>
                </div>
              </>
            )
          }
        </div>
      )}
    </div>
  )
}

export default DateTimePicker
