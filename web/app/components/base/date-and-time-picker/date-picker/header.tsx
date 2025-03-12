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
        onClick={onClickPrevMonth}
        className='p-1.5 hover:bg-state-base-hover rounded-lg'
      >
        <RiArrowUpSLine className='w-[18px] h-[18px] text-text-secondary' />
      </button>
      <button
        onClick={onClickNextMonth}
        className='p-1.5 hover:bg-state-base-hover rounded-lg'
      >
        <RiArrowDownSLine className='w-[18px] h-[18px] text-text-secondary' />
      </button>
    </div>
  )
}

export default React.memo(Header)
