'use client'

import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolDatePicker } from './tool-date-picker'
import { parseToolDateRangeValue, stringifyToolDateRangeValue } from './tool-date-range-value'

type Props = {
  label: string
  value: unknown
  onChange: (next: string) => void
  readOnly?: boolean
}

export const ToolDateRangePicker: FC<Props> = ({ label, value, onChange, readOnly = false }) => {
  const { t } = useTranslation(['workflow', 'common'])
  const startLabel = t(($) => $['nodes.tool.dateRange.startPlaceholder'], { ns: 'workflow' })
  const endLabel = t(($) => $['nodes.tool.dateRange.endPlaceholder'], { ns: 'workflow' })
  const clearLabel = t(($) => $['operation.clear'], { ns: 'common' })
  const parsed = parseToolDateRangeValue(value)

  const patch = (partial: Partial<{ start?: string; end?: string }>) => {
    const next = { ...parsed, ...partial }
    if (!next.start) delete next.start
    if (!next.end) delete next.end
    onChange(stringifyToolDateRangeValue(next))
  }

  return (
    <div role="group" aria-label={label} className="flex min-w-0 items-center gap-1">
      <ToolDatePicker
        aria-label={startLabel}
        clearLabel={`${startLabel}: ${clearLabel}`}
        value={parsed.start}
        onChange={(start) => patch({ start: start || undefined })}
        readOnly={readOnly}
        maxDate={parsed.end || undefined}
        placeholder={startLabel}
      />
      <span aria-hidden="true">–</span>
      <ToolDatePicker
        aria-label={endLabel}
        clearLabel={`${endLabel}: ${clearLabel}`}
        value={parsed.end}
        onChange={(end) => patch({ end: end || undefined })}
        readOnly={readOnly}
        minDate={parsed.start || undefined}
        placeholder={endLabel}
      />
    </div>
  )
}
