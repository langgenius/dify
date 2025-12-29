import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import {
  RiCalendarLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import dayjs from 'dayjs'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import useTimestamp from '@/hooks/use-timestamp'
import { cn } from '@/utils/classnames'

type Props = {
  className?: string
  value?: number
  onChange: (date: number | null) => void
}
const WrappedDatePicker = ({
  className,
  value,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  // const { userProfile: { timezone } } = useAppContext()
  const { formatTime: formatTimestamp } = useTimestamp()

  const handleDateChange = useCallback((date?: dayjs.Dayjs) => {
    if (date)
      onChange(date.unix())
    else
      onChange(null)
  }, [onChange])

  const renderTrigger = useCallback(({
    handleClickTrigger,
  }: TriggerProps) => {
    return (
      <div onClick={handleClickTrigger} className={cn('group flex items-center rounded-md bg-components-input-bg-normal', className)}>
        <div
          className={cn(
            'grow',
            value ? 'text-text-secondary' : 'text-text-tertiary',
          )}
        >
          {value ? formatTimestamp(value, t('metadata.dateTimeFormat', { ns: 'datasetDocuments' })) : t('metadata.chooseTime', { ns: 'dataset' })}
        </div>
        <RiCloseCircleFill
          className={cn(
            'hidden h-4 w-4 cursor-pointer hover:text-components-input-text-filled group-hover:block',
            value && 'text-text-quaternary',
          )}
          onClick={() => handleDateChange()}
        />
        <RiCalendarLine
          className={cn(
            'block h-4 w-4 shrink-0 group-hover:hidden',
            value ? 'text-text-quaternary' : 'text-text-tertiary',
          )}
        />
      </div>
    )
  }, [className, value, formatTimestamp, t, handleDateChange])

  return (
    <DatePicker
      value={dayjs(value ? value * 1000 : Date.now())}
      onChange={handleDateChange}
      onClear={handleDateChange}
      renderTrigger={renderTrigger}
      triggerWrapClassName="w-full"
      popupZIndexClassname="z-[1000]"
    />
  )
}

export default WrappedDatePicker
