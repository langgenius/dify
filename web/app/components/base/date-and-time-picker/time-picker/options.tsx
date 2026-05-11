import type { FC } from 'react'
import type { TimeOptionsProps } from '../types'
import * as React from 'react'
import OptionList from '../common/option-list'
import OptionListItem from '../common/option-list-item'
import { useTimeOptions } from '../hooks'

const Options: FC<TimeOptionsProps> = ({
  selectedTime,
  minuteFilter,
  handleSelectHour,
  handleSelectMinute,
  handleSelectPeriod,
}) => {
  const { hourOptions, minuteOptions, periodOptions } = useTimeOptions()

  return (
    <div className="grid grid-cols-3 gap-x-1 p-2">
      {/* Hour */}
      <OptionList>
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
      </OptionList>
      {/* Minute */}
      <OptionList>
        {
          (minuteFilter ? minuteFilter(minuteOptions) : minuteOptions).map((minute) => {
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
      </OptionList>
      {/* Period */}
      <OptionList>
        {
          periodOptions.map((period) => {
            const isSelected = selectedTime?.format('A') === period
            return (
              <OptionListItem
                key={period}
                isSelected={isSelected}
                onClick={handleSelectPeriod.bind(null, period)}
                noAutoScroll // if choose PM which would hide(scrolled) AM that may make user confused that there's no am.
              >
                {period}
              </OptionListItem>
            )
          })
        }
      </OptionList>
    </div>
  )
}

export default React.memo(Options)
