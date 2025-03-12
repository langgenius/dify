import React, { type FC } from 'react'
import type { CalendarItemProps } from '../types'
import cn from '@/utils/classnames'
import dayjs from '../utils/dayjs'

const Item: FC<CalendarItemProps> = ({
  day,
  selectedDate,
  onClick,
}) => {
  const { date, isCurrentMonth } = day
  const isSelected = selectedDate?.isSame(date, 'date')
  const isToday = date.isSame(dayjs(), 'date')

  return (
    <button
      onClick={() => onClick(date)}
      className={cn(
        'relative px-1 py-2 rounded-lg flex items-center justify-center system-sm-medium',
        isCurrentMonth ? 'text-text-secondary' : 'text-text-quaternary hover:text-text-secondary',
        isSelected ? 'text-components-button-primary-text system-sm-medium bg-components-button-primary-bg' : 'hover:bg-state-base-hover',
      )}
    >
      {date.date()}
      {isToday && <div className='absolute bottom-1 mx-auto w-1 h-1 rounded-full bg-components-button-primary-bg' />}
    </button>
  )
}

export default React.memo(Item)
