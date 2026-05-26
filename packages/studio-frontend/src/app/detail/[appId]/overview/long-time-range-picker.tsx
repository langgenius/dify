'use client'
import type { FC } from 'react'
import type { PeriodParams } from '@/app/components/app/overview/app-chart'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import dayjs from 'dayjs'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>
type TimePeriodOption = {
  value: string
  name: string
}

type Props = {
  periodMapping: { [key: string]: { value: number, name: TimePeriodName } }
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
  const items = React.useMemo<TimePeriodOption[]>(() => {
    return Object.entries(periodMapping).map(([key, period]) => ({
      value: key,
      name: t(`filter.period.${period.name}`, { ns: 'appLog' }),
    }))
  }, [periodMapping, t])
  const [value, setValue] = React.useState('2')
  const selectedItem = React.useMemo(() => {
    return items.find(item => item.value === value) ?? null
  }, [items, value])

  const handleSelect = React.useCallback((item: TimePeriodOption) => {
    const id = item.value
    const value = periodMapping[id]?.value ?? '-1'
    const name = item.name || t('filter.period.allTime', { ns: 'appLog' })
    if (value === -1) {
      onSelect({ name: t('filter.period.allTime', { ns: 'appLog' }), query: undefined })
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
    <Select
      value={selectedItem?.value ?? null}
      onValueChange={(nextValue) => {
        if (!nextValue)
          return
        const nextItem = items.find(item => item.value === nextValue)
        if (!nextItem)
          return
        setValue(nextValue)
        handleSelect(nextItem)
      }}
    >
      <SelectTrigger className="mt-0 w-fit max-w-none">
        {selectedItem?.name ?? t('placeholder.select', { ns: 'common' })}
      </SelectTrigger>
      <SelectContent>
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>
            <SelectItemText>{item.name}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export default React.memo(LongTimeRangePicker)
