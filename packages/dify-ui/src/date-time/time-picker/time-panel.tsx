import * as React from 'react'
import { OptionColumn } from '../internal/option-column'
import { PickerColumns } from '../internal/picker-panel'
import { usePickerNumbers } from '../internal/use-picker-numbers'
import { formatTimeValue, parseTimeValue } from './time-value'

type TimePanelLabels = { hour: string; minute: string; period: string; am: string; pm: string }
type TimePanelProps = {
  value: string
  onValueChange: (update: (value: string) => string) => void
  labels: TimePanelLabels
  locale?: Intl.LocalesArgument
  hourCycle?: 12 | 24
  scrollRequest?: number
  minuteStep?: 1 | 5 | 10 | 15 | 20 | 30
}

function TimePanel({
  value,
  onValueChange,
  labels,
  locale,
  hourCycle = 12,
  scrollRequest,
  minuteStep = 1,
}: TimePanelProps) {
  const numbers = usePickerNumbers(locale)
  const current = parseTimeValue(value)
  if (!current) throw new RangeError(`Invalid time of day: ${value}`)
  const period = current.hour < 12 ? 0 : 1
  const displayHour = hourCycle === 24 ? current.hour : current.hour % 12 || 12
  function update(part: 'hour' | 'minute' | 'period', next: number) {
    onValueChange((previous) => {
      const time = parseTimeValue(previous)!
      if (part === 'minute') time.minute = next
      else if (part === 'period') time.hour = (time.hour % 12) + next * 12
      else time.hour = hourCycle === 24 ? next : (next % 12) + Math.floor(time.hour / 12) * 12
      return formatTimeValue(time)
    })
  }
  return (
    <PickerColumns>
      <OptionColumn
        scrollRequest={scrollRequest}
        normalizeDigits={numbers.normalizeDigits}
        label={labels.hour}
        value={displayHour}
        options={Array.from({ length: hourCycle }, (_, index) => {
          const hour = hourCycle === 24 ? index : index + 1
          return { value: hour, label: numbers.formatInteger(hour) }
        })}
        onValueChange={(hour) => update('hour', hour)}
      />
      <OptionColumn
        scrollRequest={scrollRequest}
        normalizeDigits={numbers.normalizeDigits}
        label={labels.minute}
        value={current.minute}
        options={Array.from({ length: 60 / minuteStep }, (_, index) => ({
          value: index * minuteStep,
          label: numbers.formatMinute(index * minuteStep),
        }))}
        onValueChange={(minute) => update('minute', minute)}
      />
      {hourCycle === 12 && (
        <OptionColumn
          scrollRequest={scrollRequest}
          normalizeDigits={numbers.normalizeDigits}
          label={labels.period}
          value={period}
          options={[
            { value: 0, label: labels.am },
            { value: 1, label: labels.pm },
          ]}
          onValueChange={(next) => update('period', next)}
        />
      )}
    </PickerColumns>
  )
}
export { TimePanel }
export type { TimePanelLabels, TimePanelProps }
