import React, { type FC } from 'react'
import type { YearAndMonthPickerOptionsProps } from '../types'
import { useMonths, useYearOptions } from '../hooks'
import OptionListItem from '../common/option-list-item'

const Options: FC<YearAndMonthPickerOptionsProps> = ({
  selectedMonth,
  selectedYear,
  handleMonthSelect,
  handleYearSelect,
}) => {
  const months = useMonths()
  const yearOptions = useYearOptions()

  return (
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
                onClick={handleMonthSelect.bind(null, index)}
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
                onClick={handleYearSelect.bind(null, year)}
              >
                {year}
              </OptionListItem>
            )
          })
        }
      </ul>
    </div>
  )
}

export default React.memo(Options)
