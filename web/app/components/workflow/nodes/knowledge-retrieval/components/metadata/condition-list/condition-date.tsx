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
import { cn } from '@/utils/classnames'

type ConditionDateProps = {
  value?: number
  onChange: (date?: number) => void
}
const ConditionDate = ({
  value,
  onChange,
}: ConditionDateProps) => {
  const { t } = useTranslation()
  const { userProfile: { timezone } } = useAppContext()

  const handleDateChange = useCallback((date?: dayjs.Dayjs) => {
    if (date)
      onChange(date.unix())
    else
      onChange()
  }, [onChange])

  const renderTrigger = useCallback(({
    handleClickTrigger,
  }: TriggerProps) => {
    return (
      <div className="group flex w-full items-center" onClick={handleClickTrigger}>
        <div
          className={cn(
            'system-xs-regular mr-0.5 h-6 grow cursor-pointer truncate px-1 leading-6',
            value ? 'text-text-secondary' : 'text-text-tertiary',
          )}
        >
          {
            value
              ? dayjs(value * 1000).tz(timezone).format('MMMM DD YYYY HH:mm A')
              : t('nodes.knowledgeRetrieval.metadata.panel.datePlaceholder', { ns: 'workflow' })
          }
        </div>
        {
          !!value && (
            <RiCloseCircleFill
              className={cn(
                'hidden h-4 w-4 shrink-0 cursor-pointer hover:text-components-input-text-filled group-hover:block',
                value && 'text-text-quaternary',
              )}
              onClick={(e) => {
                e.stopPropagation()
                handleDateChange()
              }}
            />
          )
        }
        <RiCalendarLine
          className={cn(
            'block h-4 w-4 shrink-0',
            value ? 'text-text-quaternary' : 'text-text-tertiary',
            value && 'group-hover:hidden',
          )}
        />
      </div>
    )
  }, [value, handleDateChange, timezone, t])

  return (
    <div className="flex h-8 items-center pl-1 pr-2">
      <DatePicker
        timezone={timezone}
        value={value ? dayjs(value * 1000) : undefined}
        onChange={handleDateChange}
        onClear={handleDateChange}
        renderTrigger={renderTrigger}
      />
    </div>
  )
}

export default ConditionDate
