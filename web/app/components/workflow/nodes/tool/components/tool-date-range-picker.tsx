'use client'

import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import DateRangePicker from '@/app/components/base/date-and-time-picker/date-range-picker'
import { toDayjs as parseDayjs } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { parseToolDateRangeValue, stringifyToolDateRangeValue } from './tool-date-range-value'

const DATE_FMT = 'YYYY-MM-DD'

const toDayjs = (raw?: string, timezone?: string): Dayjs | undefined => {
  if (!raw) return undefined
  return parseDayjs(raw, { timezone, format: DATE_FMT })
}

type Props = {
  value: unknown
  onChange: (next: string) => void
  readOnly?: boolean
  timezone: string
  inPanel?: boolean
}

const ToolDateRangePicker: FC<Props> = ({ value, onChange, readOnly = false, timezone }) => {
  const { t } = useTranslation()
  const parsed = parseToolDateRangeValue(value)

  const patch = (partial: Partial<{ start?: string; end?: string }>) => {
    const next = { ...parsed, ...partial }
    if (!next.start) delete next.start
    if (!next.end) delete next.end
    onChange(stringifyToolDateRangeValue(next))
  }

  return (
    <div className="min-w-0">
      <DateRangePicker
        className="max-w-full"
        start={toDayjs(parsed.start, timezone)}
        end={toDayjs(parsed.end, timezone)}
        timezone={timezone}
        displayFormat={t(($) => $['dateFormats.display'], { ns: 'time' })}
        startPlaceholder={t(($) => $['nodes.tool.dateRange.startPlaceholder'], { ns: 'workflow' })}
        endPlaceholder={t(($) => $['nodes.tool.dateRange.endPlaceholder'], { ns: 'workflow' })}
        onStartChange={(date) => patch({ start: date?.format(DATE_FMT) })}
        onEndChange={(date) => patch({ end: date?.format(DATE_FMT) })}
        clearable
        disabled={readOnly}
      />
    </div>
  )
}

export default ToolDateRangePicker
