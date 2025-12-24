import * as React from 'react'
import { useDaysOfWeek } from '../hooks'

export const DaysOfWeek = () => {
  const daysOfWeek = useDaysOfWeek()

  return (
    <div className="grid grid-cols-7 gap-x-0.5 border-b-[0.5px] border-divider-regular p-2">
      {daysOfWeek.map(day => (
        <div
          key={day as string}
          className="system-2xs-medium flex items-center justify-center text-text-tertiary"
        >
          {day as string}
        </div>
      ))}
    </div>
  )
}

export default React.memo(DaysOfWeek)
