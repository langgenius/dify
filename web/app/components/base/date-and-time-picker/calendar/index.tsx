import type { FC } from 'react'
import type { CalendarProps } from '../types'
import { DaysOfWeek } from './days-of-week'
import CalendarItem from './item'

const Calendar: FC<CalendarProps> = ({
  days,
  selectedDate,
  onDateClick,
  wrapperClassName,
  getIsDateDisabled,
}) => {
  return (
    <div className={wrapperClassName}>
      <DaysOfWeek />
      <div className="grid grid-cols-7 gap-0.5 p-2">
        {
          days.map(day => (
            <CalendarItem
              key={day.date.format('YYYY-MM-DD')}
              day={day}
              selectedDate={selectedDate}
              onClick={onDateClick}
              isDisabled={getIsDateDisabled ? getIsDateDisabled(day.date) : false}
            />
          ))
        }
      </div>
    </div>
  )
}

export default Calendar
