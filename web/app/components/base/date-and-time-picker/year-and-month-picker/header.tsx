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
    <div className='flex border-b-[0.5px] border-divider-regular p-2 pb-1'>
      {/* Year and Month */}
      <button type="button"
        onClick={onClick}
        className='system-md-semibold flex items-center gap-x-0.5 rounded-lg px-2 py-1.5 text-text-primary hover:bg-state-base-hover'
      >
        <span>{`${months[selectedMonth]} ${selectedYear}`}</span>
        <RiArrowUpSLine className='h-4 w-4 text-text-tertiary' />
      </button>
    </div>
  )
}

export default React.memo(Header)
