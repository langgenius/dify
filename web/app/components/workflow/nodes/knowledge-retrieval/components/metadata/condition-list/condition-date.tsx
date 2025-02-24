import { useCallback } from 'react'
import dayjs from 'dayjs'
import {
  RiCalendarLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import cn from '@/utils/classnames'

type ConditionDateProps = {
  value?: string
  onChange: (date: string) => void
}
const ConditionDate = ({
  value,
  onChange,
}: ConditionDateProps) => {
  const handleDateChange = useCallback((date?: dayjs.Dayjs) => {
    if (date)
      onChange(date.format('YYYY-MM-DD'))
    else
      onChange('')
  }, [onChange])

  const renderTrigger = useCallback(() => {
    return (
      <div className='group flex items-center h-8'>
        <div
          className={cn(
            'grow',
            value ? 'text-text-secondary' : 'text-text-tertiary',
          )}
        >
          {value || 'Choose a time...'}
        </div>
        <RiCloseCircleFill
          className={cn(
            'hidden group-hover:block w-4 h-4 cursor-pointer hover:text-components-input-text-filled',
            value && 'text-text-quaternary',
          )}
          onClick={() => handleDateChange()}
        />
        <RiCalendarLine
          className={cn(
            'block group-hover:hidden shrink-0 w-4 h-4',
            value ? 'text-text-quaternary' : 'text-text-tertiary',
          )}
        />
      </div>
    )
  }, [value, handleDateChange])

  return (
    <DatePicker
      value={dayjs(value)}
      onChange={handleDateChange}
      onClear={handleDateChange}
      renderTrigger={renderTrigger}
    >

    </DatePicker>
  )
}

export default ConditionDate
