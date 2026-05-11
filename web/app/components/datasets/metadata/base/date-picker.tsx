import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import { cn } from '@langgenius/dify-ui/cn'
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
  const { userProfile: { timezone } } = useAppContext()
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
    const hasValue = Boolean(value)
    const triggerText = value ? formatTimestamp(value, t('metadata.dateTimeFormat', { ns: 'datasetDocuments' })) : t('metadata.chooseTime', { ns: 'dataset' })

    return (
      <div className={cn('group flex items-center rounded-md bg-components-input-bg-normal', className)}>
        <button
          type="button"
          className="flex min-w-0 grow items-center border-none bg-transparent p-0 text-left focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={handleClickTrigger}
        >
          <span
            className={cn(
              'grow',
              hasValue ? 'text-text-secondary' : 'text-text-tertiary',
            )}
          >
            {triggerText}
          </span>
          <RiCalendarLine
            aria-hidden="true"
            className={cn(
              'block h-4 w-4 shrink-0',
              hasValue ? 'text-text-quaternary group-hover:hidden' : 'text-text-tertiary',
            )}
          />
        </button>
        {hasValue
          ? (
              <button
                type="button"
                aria-label={t('operation.clear', { ns: 'common' })}
                className={cn(
                  'hidden h-4 w-4 cursor-pointer rounded-full border-none bg-transparent p-0 text-text-quaternary group-hover:block hover:text-components-input-text-filled focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  handleDateChange()
                }}
              >
                <RiCloseCircleFill className="h-4 w-4" aria-hidden="true" />
              </button>
            )
          : null}
      </div>
    )
  }, [className, value, formatTimestamp, t, handleDateChange])

  return (
    <DatePicker
      value={dayjs(value ? value * 1000 : Date.now())}
      timezone={timezone}
      onChange={handleDateChange}
      onClear={handleDateChange}
      renderTrigger={renderTrigger}
      triggerWrapClassName="w-full"
    />
  )
}

export default WrappedDatePicker
