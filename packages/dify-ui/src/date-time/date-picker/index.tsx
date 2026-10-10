'use client'

import type { CalendarPanelLabels, CalendarPanelProps } from '../date-picker/calendar-panel'
import type {
  PickerClearProps,
  PickerContentProps,
  PickerFieldProps,
  PickerLabelProps,
  PickerTriggerProps,
  PickerValueProps,
} from '../internal/picker-parts'
import { useControlled } from '@base-ui/utils/useControlled'
import { enUS } from '@daypicker/react/locale/en-US'
import * as React from 'react'
import { CalendarPanel } from '../date-picker/calendar-panel'
import { formatDateValue, getInitialMonth, requireDateValue } from '../date-picker/date-value'
import {
  PickerClear,
  PickerContent,
  PickerLabel,
  PickerRoot,
  PickerTrigger,
  PickerValue,
  usePickerContext,
} from '../internal/picker-parts'

type DatePickerProps = PickerFieldProps &
  Pick<CalendarPanelProps, 'locale' | 'minDate' | 'maxDate' | 'isDateUnavailable'> & {
    /** A Gregorian YYYY-MM-DD civil date; null represents an empty field. */
    value?: string | null
    defaultValue?: string | null
    /** Called on day confirmation, clearing or form reset. */
    onValueChange?: (value: string | null) => void
    labels?: Partial<CalendarPanelLabels>
  }
type ContextValue = Omit<
  DatePickerProps,
  'value' | 'defaultValue' | 'onValueChange' | 'children'
> & {
  value: Exclude<DatePickerProps['value'], undefined>
  commit: NonNullable<DatePickerProps['onValueChange']>
}
const Context = React.createContext<ContextValue | null>(null)
function useContext() {
  const context = React.useContext(Context)
  if (!context) throw new Error('DatePicker parts require DatePicker.')
  return context
}
const defaultLabels: CalendarPanelLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  chooseMonthAndYear: 'Choose month and year',
  month: 'Month',
  year: 'Year',
  cancel: 'Cancel',
  apply: 'OK',
  unavailable: 'This date is unavailable.',
}

function DatePicker({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  children,
  ...props
}: DatePickerProps) {
  const [value, setValue] = useControlled({
    controlled: valueProp,
    default: defaultValue,
    name: 'DatePicker',
  })
  requireDateValue(value)
  if (props.minDate) requireDateValue(props.minDate)
  if (props.maxDate) requireDateValue(props.maxDate)
  if (props.minDate && props.maxDate && props.minDate > props.maxDate)
    throw new RangeError('minDate exceeds maxDate')
  const unavailable = Boolean(
    value &&
    ((props.minDate && value < props.minDate) ||
      (props.maxDate && value > props.maxDate) ||
      props.isDateUnavailable?.(value)),
  )
  function commit(next: string | null) {
    if (props.disabled || props.readOnly) return
    if (next !== value) {
      setValue(next)
      onValueChange?.(next)
    }
  }
  return (
    <Context.Provider value={{ ...props, value, commit }}>
      <PickerRoot
        {...props}
        invalid={props.invalid || unavailable}
        validationMessage={
          unavailable
            ? (props.labels?.unavailable ?? defaultLabels.unavailable)
            : props.validationMessage
        }
        placeholder={props.placeholder ?? 'Select date'}
        displayValue={
          value
            ? new Intl.DateTimeFormat(props.locale?.code ?? 'en-US', {
                year: 'numeric',
                calendar: 'gregory',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              }).format(requireDateValue(value)!)
            : ''
        }
        serializedValue={value ?? ''}
        onClear={() => commit(null)}
        onReset={() => {
          setValue(defaultValue)
          if (defaultValue !== value) onValueChange?.(defaultValue)
        }}
      >
        {children}
      </PickerRoot>
    </Context.Provider>
  )
}
type DatePickerTriggerProps = PickerTriggerProps
type DatePickerContentProps = PickerContentProps
type DatePickerClearProps = PickerClearProps
type DatePickerLabelProps = PickerLabelProps
type DatePickerValueProps = PickerValueProps
const DatePickerTrigger = PickerTrigger
const DatePickerClear = PickerClear
const DatePickerLabel = PickerLabel
const DatePickerValue = PickerValue
function DatePickerContent(props: DatePickerContentProps) {
  const { value } = useContext()
  return (
    <PickerContent {...props}>
      <Session key={value ?? ''} />
    </PickerContent>
  )
}
function Session() {
  const { value, commit, locale = enUS, minDate, maxDate, isDateUnavailable, labels } = useContext()
  const { close } = usePickerContext()
  const [displayMonth, setDisplayMonth] = React.useState(() =>
    getInitialMonth(value ?? formatDateValue(new Date()), minDate, maxDate),
  )
  return (
    <CalendarPanel
      value={value}
      onSelect={(next) => {
        commit(next)
        close()
      }}
      displayMonth={displayMonth}
      onDisplayMonthChange={setDisplayMonth}
      locale={locale}
      minDate={minDate}
      maxDate={maxDate}
      isDateUnavailable={isDateUnavailable}
      labels={{ ...defaultLabels, ...labels }}
    />
  )
}

export {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
}
export type {
  DatePickerClearProps,
  DatePickerContentProps,
  DatePickerLabelProps,
  DatePickerProps,
  DatePickerTriggerProps,
  DatePickerValueProps,
}
