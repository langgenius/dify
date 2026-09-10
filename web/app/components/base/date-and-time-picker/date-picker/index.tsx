import type { PopoverProps } from '@langgenius/dify-ui/popover'
import type { Dayjs } from 'dayjs'
import type { DatePickerProps, Period } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Calendar from '../calendar'
import TimePickerHeader from '../time-picker/header'
import TimePickerOptions from '../time-picker/options'
import { ViewType } from '../types'
import dayjs, {
  clearMonthMapCache,
  cloneTime,
  getDateWithTimezone,
  getDaysInMonth,
  getHourIn12Hour,
} from '../utils/dayjs'
import YearAndMonthPickerFooter from '../year-and-month-picker/footer'
import YearAndMonthPickerHeader from '../year-and-month-picker/header'
import YearAndMonthPickerOptions from '../year-and-month-picker/options'
import DatePickerFooter from './footer'
import DatePickerHeader from './header'

const DatePicker = ({
  value,
  timezone,
  onChange,
  onClear,
  placeholder,
  disabled = false,
  needTimePicker = true,
  renderTrigger,
  triggerWrapClassName,
  noConfirm,
  getIsDateDisabled,
}: DatePickerProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState(ViewType.date)
  const isInitialRef = useRef(true)
  const triggerAreaRef = useRef<HTMLDivElement>(null)

  // Normalize the value to ensure that all subsequent uses are Day.js objects.
  const normalizedValue = useMemo(() => {
    if (!value) return undefined
    return dayjs.isDayjs(value) ? value.tz(timezone) : dayjs(value).tz(timezone)
  }, [value, timezone])

  const inputValue = useRef(normalizedValue).current
  const defaultValue = useRef(getDateWithTimezone({ timezone })).current

  const [currentDate, setCurrentDate] = useState(inputValue || defaultValue)
  const [selectedDate, setSelectedDate] = useState(inputValue)

  const [selectedMonth, setSelectedMonth] = useState(() => (inputValue || defaultValue).month())
  const [selectedYear, setSelectedYear] = useState(() => (inputValue || defaultValue).year())

  useEffect(() => {
    if (isInitialRef.current) {
      isInitialRef.current = false
      return
    }
    clearMonthMapCache()
    if (normalizedValue) {
      const newValue = getDateWithTimezone({ date: normalizedValue, timezone })
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- timezone changes intentionally resync the displayed calendar state.
      setCurrentDate(newValue)
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- timezone changes intentionally resync the selected value.
      setSelectedDate(newValue)
      onChange(newValue)
    } else {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- timezone changes intentionally resync the displayed calendar state.
      setCurrentDate((prev) => getDateWithTimezone({ date: prev, timezone }))
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- timezone changes intentionally resync the selected value.
      setSelectedDate((prev) => (prev ? getDateWithTimezone({ date: prev, timezone }) : undefined))
    }
    // oxlint-disable-next-line react/exhaustive-deps -- this effect intentionally runs only when timezone changes.
  }, [timezone])

  const handleOpenChange = useCallback<NonNullable<PopoverProps['onOpenChange']>>(
    (nextOpen, details) => {
      const isFocusGuardClose =
        !nextOpen && details.reason === 'focus-out' && details.event.type === 'focusin'
      if (isFocusGuardClose) {
        details.cancel()
        // Let Base UI move focus past its guard before the controlled root closes.
        queueMicrotask(() => {
          setIsOpen(false)
          setView(ViewType.date)
        })
        return
      }
      const outsideTarget =
        details.reason === 'focus-out' && details.event instanceof FocusEvent
          ? details.event.relatedTarget
          : details.event.target
      if (
        !nextOpen &&
        (details.reason === 'outside-press' || details.reason === 'focus-out') &&
        outsideTarget instanceof Node &&
        triggerAreaRef.current?.contains(outsideTarget)
      ) {
        details.cancel()
        return
      }
      setIsOpen(nextOpen)
      setView(ViewType.date)
      if (nextOpen && normalizedValue) {
        setCurrentDate(normalizedValue)
        setSelectedDate(normalizedValue)
      }
    },
    [normalizedValue],
  )

  const handleClickTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedDate(undefined)
    if (!isOpen) onClear()
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

  const handleConfirmDate = useCallback(
    (passedInSelectedDate?: Dayjs) => {
      // passedInSelectedDate may be a click event when noConfirm is false
      const nextDate = dayjs.isDayjs(passedInSelectedDate) ? passedInSelectedDate : selectedDate
      onChange(nextDate ? nextDate.tz(timezone) : undefined)
      setIsOpen(false)
    },
    [selectedDate, onChange, timezone],
  )

  const handleDateSelect = useCallback(
    (day: Dayjs) => {
      const newDate = cloneTime(day, selectedDate || getDateWithTimezone({ timezone }))
      setCurrentDate(newDate)
      setSelectedDate(newDate)
      if (noConfirm) handleConfirmDate(newDate)
    },
    [selectedDate, timezone, noConfirm, handleConfirmDate],
  )

  const handleSelectCurrentDate = () => {
    const newDate = getDateWithTimezone({ timezone })
    setCurrentDate(newDate)
    setSelectedDate(newDate)
    onChange(newDate)
    setIsOpen(false)
  }

  const handleClickTimePicker = () => {
    if (view === ViewType.date) {
      setView(ViewType.time)
      return
    }
    if (view === ViewType.time) setView(ViewType.date)
  }

  const handleTimeSelect = (hour: string, minute: string, period: Period) => {
    const newTime = cloneTime(dayjs(), dayjs(`1/1/2000 ${hour}:${minute} ${period}`))
    setSelectedDate((prev) => {
      return prev ? cloneTime(prev, newTime) : newTime
    })
  }

  const handleSelectHour = useCallback(
    (hour: string) => {
      const selectedTime = selectedDate || getDateWithTimezone({ timezone })
      handleTimeSelect(
        hour,
        selectedTime.minute().toString().padStart(2, '0'),
        selectedTime.format('A') as Period,
      )
    },
    [selectedDate, timezone],
  )

  const handleSelectMinute = useCallback(
    (minute: string) => {
      const selectedTime = selectedDate || getDateWithTimezone({ timezone })
      handleTimeSelect(
        getHourIn12Hour(selectedTime).toString().padStart(2, '0'),
        minute,
        selectedTime.format('A') as Period,
      )
    },
    [selectedDate, timezone],
  )

  const handleSelectPeriod = useCallback(
    (period: Period) => {
      const selectedTime = selectedDate || getDateWithTimezone({ timezone })
      handleTimeSelect(
        getHourIn12Hour(selectedTime).toString().padStart(2, '0'),
        selectedTime.minute().toString().padStart(2, '0'),
        period,
      )
    },
    [selectedDate, timezone],
  )

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
    setCurrentDate((prev) => prev.clone().month(selectedMonth).year(selectedYear))
    setView(ViewType.date)
  }

  const timeFormat = needTimePicker
    ? t(($) => $['dateFormats.displayWithTime'], { ns: 'time' })
    : t(($) => $['dateFormats.display'], { ns: 'time' })
  const displayValue = normalizedValue?.format(timeFormat) || ''
  const displayTime = selectedDate?.format('hh:mm A') || '--:-- --'
  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <div ref={triggerAreaRef} className={cn('min-w-0', triggerWrapClassName)}>
        <PopoverTrigger
          disabled={disabled}
          onClick={handleClickTrigger}
          className={triggerWrapClassName}
          render={(props, state) => {
            if (renderTrigger) {
              return renderTrigger(props, state, {
                value: normalizedValue,
                selectedDate,
                handleClear,
              })
            }

            const triggerPlaceholder = placeholder || t(($) => $.defaultPlaceholder, { ns: 'time' })
            const triggerDisplayValue = state.open
              ? selectedDate?.format(timeFormat) || ''
              : displayValue

            return (
              <div
                className={cn(
                  'group relative flex w-63 items-center rounded-lg bg-components-input-bg-normal hover:bg-state-base-hover-alt',
                  disabled && 'opacity-60',
                  props.className,
                )}
              >
                <button
                  {...props}
                  type="button"
                  aria-label={`${triggerPlaceholder}${triggerDisplayValue ? `: ${triggerDisplayValue}` : ''}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-x-0.5 rounded-lg px-2 py-1 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-default"
                  data-testid="date-picker-trigger"
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate p-1 system-xs-regular',
                      triggerDisplayValue
                        ? 'text-components-input-text-filled'
                        : 'text-components-input-text-placeholder',
                    )}
                  >
                    {triggerDisplayValue || triggerPlaceholder}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'i-ri-calendar-line size-4 shrink-0 text-text-quaternary',
                      state.open ? 'text-text-secondary' : 'group-hover:text-text-secondary',
                    )}
                  />
                </button>
                {(displayValue || (state.open && selectedDate)) && !disabled && (
                  <button
                    type="button"
                    aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                    className="absolute right-2 flex size-4 shrink-0 items-center justify-center rounded-full border-none bg-components-input-bg-normal p-0 text-text-quaternary opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden [@media(hover:none)]:opacity-100"
                    onClick={handleClear}
                  >
                    <span className="i-ri-close-circle-fill size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          }}
        />
      </div>
      <PopoverContent
        placement="bottom-end"
        sideOffset={0}
        className="border-none bg-transparent shadow-none"
      >
        <div className="mt-1 w-63 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-5">
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
          {view === ViewType.date ? (
            <Calendar
              days={days}
              selectedDate={selectedDate}
              onDateClick={handleDateSelect}
              getIsDateDisabled={getIsDateDisabled}
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
          )}

          {/* Footer */}
          {[ViewType.date, ViewType.time].includes(view) && !noConfirm && (
            <DatePickerFooter
              needTimePicker={needTimePicker}
              displayTime={displayTime}
              view={view}
              handleClickTimePicker={handleClickTimePicker}
              handleSelectCurrentDate={handleSelectCurrentDate}
              handleConfirmDate={handleConfirmDate}
            />
          )}
          {![ViewType.date, ViewType.time].includes(view) && (
            <YearAndMonthPickerFooter
              handleYearMonthCancel={handleYearMonthCancel}
              handleYearMonthConfirm={handleYearMonthConfirm}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default DatePicker
