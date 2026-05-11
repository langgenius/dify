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
    const hasValue = Boolean(value)
    const triggerText = value
      ? dayjs(value * 1000).tz(timezone).format('MMMM DD YYYY HH:mm A')
      : t('nodes.knowledgeRetrieval.metadata.panel.datePlaceholder', { ns: 'workflow' })

    return (
      <div className="group flex items-center">
        <button
          type="button"
          className={cn(
            'mr-0.5 flex h-6 grow cursor-pointer items-center border-none bg-transparent px-1 py-0 text-left system-sm-regular focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
            hasValue ? 'text-text-secondary' : 'text-text-tertiary',
          )}
          onClick={handleClickTrigger}
        >
          <span className="grow">{triggerText}</span>
          <RiCalendarLine
            className={cn(
              'block h-4 w-4 shrink-0',
              hasValue ? 'text-text-quaternary' : 'text-text-tertiary',
              hasValue && 'group-hover:hidden',
            )}
            aria-hidden="true"
          />
        </button>
        {hasValue
          ? (
              <button
                type="button"
                aria-label={t('operation.clear', { ns: 'common' })}
                className="hidden h-4 w-4 shrink-0 cursor-pointer border-none bg-transparent p-0 text-text-quaternary group-hover:block hover:text-components-input-text-filled focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDateChange()
                }}
              >
                <RiCloseCircleFill className="h-4 w-4" aria-hidden="true" />
              </button>
            )
          : null}
      </div>
    )
  }, [value, handleDateChange, timezone, t])

  return (
    <div className="h-8 px-2 py-1">
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
