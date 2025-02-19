import React from 'react'
import { useDaysOfWeek } from '../hooks'

export const DaysOfWeek = () => {
  const daysOfWeek = useDaysOfWeek()

  return (
    <div className='grid grid-cols-7 gap-x-0.5 p-2 border-b-[0.5px] border-divider-regular'>
      {daysOfWeek.map(day => (
        <div
          key={day}
          className='flex items-center justify-center text-text-tertiary system-2xs-medium'
        >
          {day}
        </div>
      ))}
    </div>
  )
}

export default React.memo(DaysOfWeek)
