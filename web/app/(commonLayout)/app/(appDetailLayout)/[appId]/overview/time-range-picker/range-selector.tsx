'use client'
import type { FC } from 'react'
import type { PeriodParamsWithTimeRange, TimeRange } from '@/app/components/app/overview/app-chart'
import type { Item } from '@/app/components/base/select'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import dayjs from 'dayjs'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect } from '@/app/components/base/select'
import { cn } from '@/utils/classnames'

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

type Props = {
  isCustomRange: boolean
  ranges: { value: number, name: TimePeriodName }[]
  onSelect: (payload: PeriodParamsWithTimeRange) => void
}

const RangeSelector: FC<Props> = ({
  isCustomRange,
  ranges,
  onSelect,
}) => {
  const { t } = useTranslation()

  const handleSelectRange = useCallback((item: Item) => {
    const { name, value } = item
    let period: TimeRange | null = null
    if (value === 0) {
      const startOfToday = today.startOf('day')
      const endOfToday = today.endOf('day')
      period = { start: startOfToday, end: endOfToday }
    }
    else {
      period = { start: today.subtract(item.value as number, 'day').startOf('day'), end: today.endOf('day') }
    }
    onSelect({ query: period!, name })
  }, [onSelect])

  const renderTrigger = useCallback((item: Item | null, isOpen: boolean) => {
    return (
      <div className={cn('flex h-8 cursor-pointer items-center space-x-1.5 rounded-lg bg-components-input-bg-normal pl-3 pr-2', isOpen && 'bg-state-base-hover-alt')}>
        <div className="system-sm-regular text-components-input-text-filled">{isCustomRange ? t('filter.period.custom', { ns: 'appLog' }) : item?.name}</div>
        <RiArrowDownSLine className={cn('size-4 text-text-quaternary', isOpen && 'text-text-secondary')} />
      </div>
    )
  }, [isCustomRange])

  const renderOption = useCallback(({ item, selected }: { item: Item, selected: boolean }) => {
    return (
      <>
        {selected && (
          <span
            className={cn(
              'absolute left-2 top-[9px] flex items-center  text-text-accent',
            )}
          >
            <RiCheckLine className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <span className={cn('system-md-regular block truncate')}>{item.name}</span>
      </>
    )
  }, [])
  return (
    <SimpleSelect
      items={ranges.map(v => ({ ...v, name: t(`filter.period.${v.name}`, { ns: 'appLog' }) }))}
      className="mt-0 !w-40"
      notClearable={true}
      onSelect={handleSelectRange}
      defaultValue={0}
      wrapperClassName="h-8"
      optionWrapClassName="w-[200px] translate-x-[-24px]"
      renderTrigger={renderTrigger}
      optionClassName="flex items-center py-0 pl-7 pr-2 h-8"
      renderOption={renderOption}
    />
  )
}
export default React.memo(RangeSelector)
