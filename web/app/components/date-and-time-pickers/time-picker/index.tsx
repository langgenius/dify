import React, { useCallback, useState } from 'react'
import dayjs from 'dayjs'
import type { Period, TimePickerProps } from '../types'
import { cloneTime, getHourIn12Hour } from '../utils'
import Footer from './footer'
import Options from './options'

const TimePicker = ({
  value,
  onChange,
}: TimePickerProps) => {
  const [selectedTime, setSelectedTime] = useState(value || dayjs())

  const handleTimeSelect = (hour: string, minute: string, period: Period) => {
    const newTime = cloneTime(dayjs(), dayjs(`1/1/2000 ${hour}:${minute} ${period}`))
    setSelectedTime((prev) => {
      return prev ? cloneTime(prev, newTime) : newTime
    })
  }

  const handleSelectHour = useCallback((hour: string) => {
    handleTimeSelect(hour, selectedTime.minute().toString().padStart(2, '0'), selectedTime.format('A') as Period)
  }, [selectedTime])

  const handleSelectMinute = useCallback((minute: string) => {
    handleTimeSelect(getHourIn12Hour(selectedTime).toString().padStart(2, '0'), minute, selectedTime.format('A') as Period)
  }, [selectedTime])

  const handleSelectPeriod = useCallback((period: Period) => {
    handleTimeSelect(getHourIn12Hour(selectedTime).toString().padStart(2, '0'), selectedTime.minute().toString().padStart(2, '0'), period)
  }, [selectedTime])

  const handleSelectCurrentTime = useCallback(() => {
    setSelectedTime(dayjs())
  }, [])

  const handleConfirm = useCallback(() => {
    onChange(selectedTime)
  }, [onChange, selectedTime])

  return (
    <>
      {/* Header */}
      <div className='flex flex-col border-b-[0.5px] border-divider-regular'>
        {/* Title */}
        <div className='flex items-center px-2 py-1.5 text-text-primary system-md-semibold'>
          Pick Time
        </div>
      </div>

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
    </>
  )
}

export default TimePicker
