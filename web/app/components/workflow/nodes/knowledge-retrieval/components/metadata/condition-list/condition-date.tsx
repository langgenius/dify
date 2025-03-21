import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import {
  RiCalendarLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import cn from '@/utils/classnames'
import { useAppContext } from '@/context/app-context'

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
      <div className='group flex items-center' onClick={handleClickTrigger}>
        <div
          className={cn(
            'grow flex items-center mr-0.5 px-1 h-6 system-sm-regular cursor-pointer',
            value ? 'text-text-secondary' : 'text-text-tertiary',
          )}
        >
          {
            value
              ? dayjs(value * 1000).tz(timezone).format('MMMM DD YYYY HH:mm A')
              : t('workflow.nodes.knowledgeRetrieval.metadata.panel.datePlaceholder')
          }
        </div>
        {
          value && (
            <RiCloseCircleFill
              className={cn(
                'hidden group-hover:block shrink-0 w-4 h-4 cursor-pointer hover:text-components-input-text-filled',
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
            'block shrink-0 w-4 h-4',
            value ? 'text-text-quaternary' : 'text-text-tertiary',
            value && 'group-hover:hidden',
          )}
        />
      </div>
    )
  }, [value, handleDateChange, timezone, t])

  return (
    <div className='px-2 py-1 h-8'>
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
