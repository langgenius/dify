'use client'
import type { FC } from 'react'
import type { PeriodParamsWithTimeRange, TimeRange } from '@/app/components/app/overview/app-chart'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { RiArrowDownSLine } from '@remixicon/react'
import dayjs from 'dayjs'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>
type TimePeriodOption = {
  value: number
  name: string
}

type Props = Readonly<{
  isCustomRange: boolean
  ranges: { value: number, name: TimePeriodName }[]
  onSelect: (payload: PeriodParamsWithTimeRange) => void
}>

const RangeSelector: FC<Props> = ({
  isCustomRange,
  ranges,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const items = useMemo<TimePeriodOption[]>(() => {
    return ranges.map(range => ({
      ...range,
      name: t($ => $[`filter.period.${range.name}`], { ns: 'appLog' }),
    }))
  }, [ranges, t])
  const [value, setValue] = useState(0)
  const selectedItem = useMemo(() => {
    return items.find(item => item.value === value) ?? null
  }, [items, value])

  const handleSelectRange = useCallback((item: TimePeriodOption) => {
    const { name, value } = item
    let period: TimeRange | null = null
    if (value === 0) {
      const startOfToday = today.startOf('day')
      const endOfToday = today.endOf('day')
      period = { start: startOfToday, end: endOfToday }
    }
    else {
      period = { start: today.subtract(item.value, 'day').startOf('day'), end: today.endOf('day') }
    }
    onSelect({ query: period!, name })
  }, [onSelect])

  return (
    <Select<number>
      value={selectedItem?.value ?? null}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(nextValue) => {
        if (nextValue == null)
          return
        const nextItem = items.find(item => item.value === nextValue)
        if (!nextItem)
          return
        setValue(nextValue)
        handleSelectRange(nextItem)
      }}
    >
      <SelectTrigger
        className="h-auto w-fit max-w-none border-0 bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent [&>*:last-child]:hidden"
      >
        <div className="flex h-8 cursor-pointer items-center space-x-1.5 rounded-lg bg-components-input-bg-normal pr-2 pl-3 group-data-popup-open:bg-state-base-hover-alt">
          <div className="system-sm-regular text-components-input-text-filled">{isCustomRange ? t($ => $['filter.period.custom'], { ns: 'appLog' }) : selectedItem?.name}</div>
          <RiArrowDownSLine className="size-4 text-text-quaternary group-data-popup-open:text-text-secondary" />
        </div>
      </SelectTrigger>
      <SelectContent className="translate-x-[-24px]" popupClassName="w-[200px]" listClassName="p-1">
        {items.map(item => (
          <SelectItem key={item.value} value={item.value} className="relative h-8 py-0 pr-2 pl-7 system-md-regular">
            <SelectItemText className="px-0">{item.name}</SelectItemText>
            <SelectItemIndicator className="absolute top-[8px] left-2 ml-0" />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export default React.memo(RangeSelector)
