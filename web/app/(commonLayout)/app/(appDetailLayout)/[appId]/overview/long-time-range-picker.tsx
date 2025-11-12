'use client'
import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import type { FC } from 'react'
import React from 'react'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect } from '@/app/components/base/select'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
type Props = {
  periodMapping: { [key: string]: { value: number; name: string } }
  onSelect: (payload: PeriodParams) => void
  queryDateFormat: string
}

const today = dayjs()

const LongTimeRangePicker: FC<Props> = ({
  periodMapping,
  onSelect,
  queryDateFormat,
}) => {
  const { t } = useTranslation()

  const handleSelect = React.useCallback((item: Item) => {
    const id = item.value
    const value = periodMapping[id]?.value ?? '-1'
    const name = item.name || t('appLog.filter.period.allTime')
    if (value === -1) {
      onSelect({ name: t('appLog.filter.period.allTime'), query: undefined })
    }
    else if (value === 0) {
      const startOfToday = today.startOf('day').format(queryDateFormat)
      const endOfToday = today.endOf('day').format(queryDateFormat)
      onSelect({
        name,
        query: {
          start: startOfToday,
          end: endOfToday,
        },
      })
    }
    else {
      onSelect({
        name,
        query: {
          start: today.subtract(value as number, 'day').startOf('day').format(queryDateFormat),
          end: today.endOf('day').format(queryDateFormat),
        },
      })
    }
  }, [onSelect, periodMapping, queryDateFormat, t])

  return (
    <SimpleSelect
      items={Object.entries(periodMapping).map(([k, v]) => ({ value: k, name: t(`appLog.filter.period.${v.name}`) }))}
      className='mt-0 !w-40'
      notClearable={true}
      onSelect={handleSelect}
      defaultValue={'2'}
    />
  )
}
export default React.memo(LongTimeRangePicker)
