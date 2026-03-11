import type { FC } from 'react'
import type { CalendarItemProps } from '../types'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import dayjs from '../utils/dayjs'

const Item: FC<CalendarItemProps> = ({
  day,
  selectedDate,
  onClick,
  isDisabled,
}) => {
  const { date, isCurrentMonth } = day
  const isSelected = selectedDate?.isSame(date, 'date')
  const isToday = date.isSame(dayjs(), 'date')

  return (
    <button
      type="button"
      onClick={() => !isDisabled && onClick(date)}
      className={cn(
        'system-sm-medium relative flex items-center justify-center rounded-lg px-1 py-2',
        isCurrentMonth ? 'text-text-secondary' : 'text-text-quaternary hover:text-text-secondary',
        isSelected ? 'system-sm-medium bg-components-button-primary-bg text-components-button-primary-text' : 'hover:bg-state-base-hover',
        isDisabled && 'cursor-not-allowed text-text-quaternary hover:bg-transparent',
      )}
    >
      {date.date()}
      {isToday && <div className="absolute bottom-1 mx-auto h-1 w-1 rounded-full bg-components-button-primary-bg" />}
    </button>
  )
}

export default React.memo(Item)
