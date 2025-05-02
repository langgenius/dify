import React, { type FC } from 'react'
import { useTimeOptions } from '../hooks'
import type { TimeOptionsProps } from '../types'
import OptionListItem from '../common/option-list-item'

const Options: FC<TimeOptionsProps> = ({
  selectedTime,
  handleSelectHour,
  handleSelectMinute,
  handleSelectPeriod,
}) => {
  const { hourOptions, minuteOptions, periodOptions } = useTimeOptions()

  return (
    <div className='grid grid-cols-3 gap-x-1 p-2'>
      {/* Hour */}
      <ul className='flex flex-col gap-y-0.5 h-[208px] overflow-y-auto no-scrollbar pb-[184px]'>
        {
          hourOptions.map((hour) => {
            const isSelected = selectedTime?.format('hh') === hour
            return (
              <OptionListItem
                key={hour}
                isSelected={isSelected}
                onClick={handleSelectHour.bind(null, hour)}
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
            const isSelected = selectedTime?.format('mm') === minute
            return (
              <OptionListItem
                key={minute}
                isSelected={isSelected}
                onClick={handleSelectMinute.bind(null, minute)}
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
            const isSelected = selectedTime?.format('A') === period
            return (
              <OptionListItem
                key={period}
                isSelected={isSelected}
                onClick={handleSelectPeriod.bind(null, period)}
              >
                {period}
              </OptionListItem>
            )
          })
        }
      </ul>
    </div>
  )
}

export default React.memo(Options)
