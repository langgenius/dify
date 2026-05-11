import type { FC } from 'react'
import type { YearAndMonthPickerOptionsProps } from '../types'
import * as React from 'react'
import OptionList from '../common/option-list'
import OptionListItem from '../common/option-list-item'
import { useMonths, useYearOptions } from '../hooks'

const Options: FC<YearAndMonthPickerOptionsProps> = ({
  selectedMonth,
  selectedYear,
  handleMonthSelect,
  handleYearSelect,
}) => {
  const months = useMonths()
  const yearOptions = useYearOptions()

  return (
    <div className="grid grid-cols-2 gap-x-1 p-2">
      {/* Month Picker */}
      <OptionList>
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
      </OptionList>
      {/* Year Picker */}
      <OptionList>
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
      </OptionList>
    </div>
  )
}

export default React.memo(Options)
