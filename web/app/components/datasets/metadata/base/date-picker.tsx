import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import {
  RiCalendarLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import dayjs from 'dayjs'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import { useAppContext } from '@/context/app-context'
import useTimestamp from '@/hooks/use-timestamp'
import { cn } from '@/utils/classnames'

type Props = {
  className?: string
  value?: number
  onChange: (date: number | null) => void
  readonly?: boolean
}
const WrappedDatePicker = ({
  className,
  value,
  onChange,
  readonly,
}: Props) => {
  const { t } = useTranslation()
  const { userProfile: { timezone } } = useAppContext()
  const { formatTime: formatTimestamp } = useTimestamp()

  const handleDateChange = useCallback((date?: dayjs.Dayjs) => {
    if (readonly)
      return
    if (date)
      onChange(date.unix())
    else
      onChange(null)
  }, [onChange, readonly])

  const renderTrigger = useCallback(({
    handleClickTrigger,
  }: TriggerProps) => {
    return (
      <div
        onClick={readonly ? undefined : handleClickTrigger}
        className={cn(
          'group flex items-center rounded-md bg-components-input-bg-normal',
          readonly && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
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
            readonly && 'pointer-events-none',
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
  }, [className, value, formatTimestamp, t, handleDateChange, readonly])

  return (
    <DatePicker
      value={dayjs(value ? value * 1000 : Date.now())}
      timezone={timezone}
      onChange={handleDateChange}
      onClear={handleDateChange}
      renderTrigger={renderTrigger}
      triggerWrapClassName="w-full"
      popupZIndexClassname="z-[1000]"
    />
  )
}

export default WrappedDatePicker
