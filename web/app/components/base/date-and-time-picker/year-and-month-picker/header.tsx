import React, { type FC } from 'react'
import type { YearAndMonthPickerHeaderProps } from '../types'
import { useMonths } from '../hooks'
import { RiArrowUpSLine } from '@remixicon/react'

const Header: FC<YearAndMonthPickerHeaderProps> = ({
  selectedYear,
  selectedMonth,
  onClick,
}) => {
  const months = useMonths()

  return (
    <div className='flex p-2 pb-1 border-b-[0.5px] border-divider-regular'>
      {/* Year and Month */}
      <button
        onClick={onClick}
        className='flex items-center gap-x-0.5 px-2 py-1.5 rounded-lg hover:bg-state-base-hover text-text-primary system-md-semibold'
      >
        <span>{`${months[selectedMonth]} ${selectedYear}`}</span>
        <RiArrowUpSLine className='w-4 h-4 text-text-tertiary' />
      </button>
    </div>
  )
}

export default React.memo(Header)
