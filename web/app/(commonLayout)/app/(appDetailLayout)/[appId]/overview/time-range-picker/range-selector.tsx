'use client'
import type { FC } from 'react'
import type { PeriodParamsWithTimeRange, TimeRange } from '@/app/components/app/overview/app-chart'
import type { I18nKeysByPrefix } from '@/types/i18n'
import {
  Select,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import dayjs from 'dayjs'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>
type TimePeriodOption = {
  value: number
  name: string
}

type Props = Readonly<{
  isCustomRange: boolean
  ranges: { value: number; name: TimePeriodName }[]
  onSelect: (payload: PeriodParamsWithTimeRange) => void
}>

const RangeSelector: FC<Props> = ({ isCustomRange, ranges, onSelect }) => {
  const { t } = useTranslation(['appLog'])
  const items = useMemo<TimePeriodOption[]>(() => {
    return ranges.map((range) => ({
      ...range,
      name: t(($) => $[`filter.period.${range.name}`], { ns: 'appLog' }),
    }))
  }, [ranges, t])
  const [value, setValue] = useState(0)
  const selectedItem = useMemo(() => {
    return items.find((item) => item.value === value) ?? null
  }, [items, value])

  const handleSelectRange = useCallback(
    (item: TimePeriodOption) => {
      const { name, value } = item
      // Read the date when the range is selected, so a page left open past midnight
      // does not build the period from the day the module was loaded.
      const today = dayjs()
      let period: TimeRange | null = null
      if (value === 0) {
        const startOfToday = today.startOf('day')
        const endOfToday = today.endOf('day')
        period = { start: startOfToday, end: endOfToday }
      } else {
        period = {
          start: today.subtract(item.value, 'day').startOf('day'),
          end: today.endOf('day'),
        }
      }
      onSelect({ query: period!, name })
    },
    [onSelect],
  )

  return (
    <Select<number>
      value={selectedItem?.value ?? null}
      onValueChange={(nextValue) => {
        if (nextValue == null) return
        const nextItem = items.find((item) => item.value === nextValue)
        if (!nextItem) return
        setValue(nextValue)
        handleSelectRange(nextItem)
      }}
    >
      <SelectTrigger className="w-fit">
        <SelectValue>
          {isCustomRange
            ? t(($) => $['filter.period.custom'], { ns: 'appLog' })
            : selectedItem?.name}
        </SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner>
          <SelectPopup className="w-50">
            <SelectList className="p-1">
              {items.map((item) => (
                <SelectItem
                  key={item.value}
                  value={item.value}
                  className="relative h-8 py-0 ps-7 pe-2 system-md-regular"
                >
                  <SelectItemText>{item.name}</SelectItemText>
                  <SelectItemIndicator className="absolute inset-s-2 top-2 ms-0" />
                </SelectItem>
              ))}
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  )
}
export default React.memo(RangeSelector)
