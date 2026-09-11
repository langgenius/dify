import type { FC } from 'react'
import type { CalendarItemProps } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import dayjs from '../utils/dayjs'

const Item: FC<CalendarItemProps> = ({ day, selectedDate, onClick, isDisabled }) => {
  const locale = useLocale()
  const { t } = useTranslation('common')
  const selectedDescriptionId = React.useId()
  const { date, isCurrentMonth } = day
  const isSelected = selectedDate?.isSame(date, 'date')
  const isToday = date.isSame(dayjs(), 'date')
  const dateLabel = new Intl.DateTimeFormat(locale.replace('_', '-'), {
    dateStyle: 'full',
    calendar: 'gregory',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year(), date.month(), date.date())))

  return (
    <button
      type="button"
      aria-label={dateLabel}
      aria-describedby={isSelected ? selectedDescriptionId : undefined}
      aria-current={isToday ? 'date' : undefined}
      disabled={isDisabled}
      onClick={() => !isDisabled && onClick(date)}
      className={cn(
        'relative flex items-center justify-center rounded-lg px-1 py-2 system-sm-medium focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        isCurrentMonth ? 'text-text-secondary' : 'text-text-quaternary hover:text-text-secondary',
        isSelected
          ? 'bg-components-button-primary-bg system-sm-medium text-components-button-primary-text'
          : 'hover:bg-state-base-hover',
        isDisabled && 'cursor-not-allowed text-text-quaternary hover:bg-transparent',
      )}
    >
      {date.date()}
      {isSelected && (
        <span id={selectedDescriptionId} className="sr-only">
          {t(($) => $['calendar.selectedDate'])}
        </span>
      )}
      {isToday && (
        <div
          aria-hidden
          className="absolute bottom-1 mx-auto size-1 rounded-full bg-components-button-primary-bg"
        />
      )}
    </button>
  )
}

export default React.memo(Item)
