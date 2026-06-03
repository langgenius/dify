import * as React from 'react'
import { useDaysOfWeek } from '../hooks'

export const DaysOfWeek = () => {
  const daysOfWeek = useDaysOfWeek()

  return (
    <div className="grid grid-cols-7 gap-x-0.5 border-b-[0.5px] border-divider-regular p-2">
      {daysOfWeek.map(day => (
        <div
          key={day}
          className="flex items-center justify-center system-2xs-medium text-text-tertiary"
        >
          {day}
        </div>
      ))}
    </div>
  )
}
