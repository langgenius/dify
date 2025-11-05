'use client'
import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { SimpleSelect } from '@/app/components/base/select'
import type { Item } from '@/app/components/base/select'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { HourglassShape } from '@/app/components/base/icons/src/vender/other'
import { noop } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiCalendarLine, RiCheckLine } from '@remixicon/react'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import 'dayjs/locale/zh-cn'
import { formatToLocalTime } from '@/utils/format'
import { useI18N } from '@/context/i18n'

const today = dayjs()

type Props = {
  ranges: { value: number; name: string }[]
  onSelect: (payload: PeriodParams) => void
  queryDateFormat: string
}

const TimeRangePicker: FC<Props> = ({
  ranges,
  onSelect,
  queryDateFormat,
}) => {
  const { t } = useTranslation()

  const isCustom = false

  const renderRangeTrigger = useCallback((item: Item | null, isOpen: boolean) => {
    return (
      <div className={cn('flex h-8 cursor-pointer items-center space-x-1.5 rounded-lg bg-components-input-bg-normal pl-3 pr-2', isOpen && 'bg-state-base-hover-alt')}>
        <div className='system-sm-regular text-components-input-text-filled'>{isCustom ? t('appLog.filter.period.custom') : item?.name}</div>
        <RiArrowDownSLine className={cn('size-4 text-text-quaternary', isOpen && 'text-text-secondary')} />
      </div>
    )
  }, [isCustom])

  const renderOption = useCallback(({ item, selected }: { item: Item; selected: boolean }) => {
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

  const handleSelectRange = useCallback((item: Item) => {
    const { name, value } = item
    let period: PeriodParams['query'] | null = null
    if (value === 0) {
      const startOfToday = today.startOf('day').format(queryDateFormat)
      const endOfToday = today.endOf('day').format(queryDateFormat)
      period = { start: startOfToday, end: endOfToday }
    }
    else {
      period = { start: today.subtract(item.value as number, 'day').startOf('day').format(queryDateFormat), end: today.endOf('day').format(queryDateFormat) }
    }
    onSelect({ query: period!, name })
  }, [onSelect])

  const { locale } = useI18N()

  const renderDate = useCallback(({ value, handleClickTrigger, isOpen }: { value?: Dayjs, handleClickTrigger: () => void, isOpen: boolean }) => {
    return (
      <div className={cn('system-sm-regular flex h-7 cursor-pointer items-center rounded-lg px-1 text-components-input-text-filled hover:bg-state-base-hover', isOpen && 'bg-state-base-hover')} onClick={handleClickTrigger}>
        {value ? formatToLocalTime(value, locale, 'MMM D') : ''}
      </div>
    )
  }, [locale])

  return (
    <div className='flex items-center'>
      <SimpleSelect
        items={ranges.map(v => ({ ...v, name: t(`appLog.filter.period.${v.name}`) }))}
        className='mt-0 !w-40'
        notClearable={true}
        onSelect={handleSelectRange}
        defaultValue={0}
        wrapperClassName='h-8'
        optionWrapClassName='w-[200px] translate-x-[-24px]'
        renderTrigger={renderRangeTrigger}
        optionClassName='flex items-center py-0 pl-7 pr-2 h-8'
        renderOption={renderOption}
      />
      <HourglassShape className='h-3.5 w-2 text-components-input-bg-normal' />
      <div className='flex h-8 items-center space-x-0.5 rounded-lg bg-components-input-bg-normal px-2'>
        <RiCalendarLine className='size-3.5 text-text-tertiary' />
        <DatePicker
          value={today}
          onChange={noop}
          renderTrigger={renderDate}
          needTimePicker={false}
        />
        <span className='system-sm-regular text-text-tertiary'>-</span>
        <DatePicker
          value={today}
          onChange={noop}
          renderTrigger={renderDate}
          needTimePicker={false}
        />
      </div>

    </div>
  )
}
export default React.memo(TimeRangePicker)
