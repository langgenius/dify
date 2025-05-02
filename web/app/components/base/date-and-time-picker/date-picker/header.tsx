import React, { type FC } from 'react'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import type { DatePickerHeaderProps } from '../types'
import { useMonths } from '../hooks'

const Header: FC<DatePickerHeaderProps> = ({
  handleOpenYearMonthPicker,
  currentDate,
  onClickNextMonth,
  onClickPrevMonth,
}) => {
  const months = useMonths()

  return (
    <div className='mx-2 mt-2 flex items-center'>
      <div className='flex-1'>
        <button
          onClick={handleOpenYearMonthPicker}
          className='system-md-semibold flex items-center gap-x-0.5 rounded-lg px-2 py-1.5 text-text-primary hover:bg-state-base-hover'
        >
          <span>{`${months[currentDate.month()]} ${currentDate.year()}`}</span>
          <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />
        </button>
      </div>
      <button
        onClick={onClickPrevMonth}
        className='rounded-lg p-1.5 hover:bg-state-base-hover'
      >
        <RiArrowUpSLine className='h-[18px] w-[18px] text-text-secondary' />
      </button>
      <button
        onClick={onClickNextMonth}
        className='rounded-lg p-1.5 hover:bg-state-base-hover'
      >
        <RiArrowDownSLine className='h-[18px] w-[18px] text-text-secondary' />
      </button>
    </div>
  )
}

export default React.memo(Header)
