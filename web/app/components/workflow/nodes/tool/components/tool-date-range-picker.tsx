'use client'

import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import { toDayjs as parseDayjs } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import {
  parseToolDateRangeValue,
  stringifyToolDateRangeValue,
} from './tool-date-range-value'

const DATE_FMT = 'YYYY-MM-DD'

const toDayjs = (raw?: string, timezone?: string): Dayjs | undefined => {
  if (!raw)
    return undefined
  return parseDayjs(raw, { timezone, format: DATE_FMT })
}

type Props = {
  value: unknown
  onChange: (next: string) => void
  readOnly?: boolean
  timezone: string
  inPanel?: boolean
  popupZIndexClassname?: string
}

const ToolDateRangePicker: FC<Props> = ({
  value,
  onChange,
  readOnly = false,
  timezone,
  inPanel,
  popupZIndexClassname,
}) => {
  const { t } = useTranslation()
  const parsed = parseToolDateRangeValue(value)
  const z = popupZIndexClassname ?? (inPanel ? 'z-[1000]' : 'z-[11]')

  const patch = (partial: Partial<{ start?: string, end?: string }>) => {
    const next = { ...parsed, ...partial }
    if (!next.start)
      delete next.start
    if (!next.end)
      delete next.end
    onChange(stringifyToolDateRangeValue(next))
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-row flex-nowrap items-center gap-x-2 gap-y-1 overflow-x-auto pb-0.5',
        readOnly && 'pointer-events-none opacity-60',
      )}
    >
      <span className="system-xs-regular shrink-0 text-text-quaternary">
        {t('nodes.tool.dateRange.start', { ns: 'workflow' })}
      </span>
      <div className="shrink-0">
        <DatePicker
          timezone={timezone}
          needTimePicker={false}
          noConfirm
          value={toDayjs(parsed.start, timezone)}
          onChange={(d) => {
            patch({ start: d ? d.format(DATE_FMT) : undefined })
          }}
          onClear={() => patch({ start: undefined })}
          placeholder={t('nodes.tool.dateRange.startPlaceholder', { ns: 'workflow' })}
          triggerWrapClassName="w-full max-w-full"
          popupZIndexClassname={z}
        />
      </div>
      <span className="system-xs-regular shrink-0 px-0.5 text-text-quaternary" aria-hidden="true">
        —
      </span>
      <span className="system-xs-regular shrink-0 text-text-quaternary">
        {t('nodes.tool.dateRange.end', { ns: 'workflow' })}
      </span>
      <div className="shrink-0">
        <DatePicker
          timezone={timezone}
          needTimePicker={false}
          noConfirm
          value={toDayjs(parsed.end, timezone)}
          onChange={(d) => {
            patch({ end: d ? d.format(DATE_FMT) : undefined })
          }}
          onClear={() => patch({ end: undefined })}
          placeholder={t('nodes.tool.dateRange.endPlaceholder', { ns: 'workflow' })}
          triggerWrapClassName="w-full max-w-full"
          popupZIndexClassname={z}
        />
      </div>
    </div>
  )
}

export default ToolDateRangePicker
