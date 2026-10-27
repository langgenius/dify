'use client'

import type { CalendarPanelLabels, CalendarPanelProps } from '../internal/calendar-panel'
import type {
  PickerClearProps,
  PickerContentProps,
  PickerFieldProps,
  PickerLabelProps,
  PickerTriggerProps,
  PickerValueProps,
} from '../internal/picker-parts'
import type {
  PickerChangeEventDetails,
  PickerChangeEventReason,
} from '../internal/use-picker-value'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import { enUS } from '@daypicker/react/locale/en-US'
import * as React from 'react'
import { CalendarPanel } from '../internal/calendar-panel'
import { formatDateValue, getInitialMonth, requireDateValue } from '../internal/date-value'
import {
  PickerClear,
  PickerContent,
  PickerLabel,
  PickerRoot,
  PickerTrigger,
  PickerValue,
  usePickerContext,
} from '../internal/picker-parts'
import { usePickerValue } from '../internal/use-picker-value'

type DatePickerLabels = CalendarPanelLabels & { close: string }

type DatePickerChangeEventReason = PickerChangeEventReason
type DatePickerChangeEventDetails = PickerChangeEventDetails

type DatePickerProps = PickerFieldProps &
  Pick<CalendarPanelProps, 'locale' | 'minDate' | 'maxDate' | 'isDateUnavailable'> & {
    /** A Gregorian YYYY-MM-DD civil date; null represents an empty field. */
    value?: string | null
    defaultValue?: string | null
    /** Called on day confirmation, clearing or form reset. */
    onValueChange?: (value: string | null, details: DatePickerChangeEventDetails) => void
    labels?: Partial<DatePickerLabels>
  }
type ContextValue = Omit<
  DatePickerProps,
  'value' | 'defaultValue' | 'onValueChange' | 'children' | 'labels'
> & {
  labels: DatePickerLabels
  value: Exclude<DatePickerProps['value'], undefined>
  commit: (value: string | null, details: DatePickerChangeEventDetails) => boolean
}
const Context = React.createContext<ContextValue | null>(null)
function useContext() {
  const context = React.useContext(Context)
  if (!context) throw new Error('DatePicker parts require DatePicker.')
  return context
}
const defaultLabels: DatePickerLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  chooseMonthAndYear: 'Choose month and year',
  month: 'Month',
  year: 'Year',
  cancel: 'Cancel',
  close: 'Close',
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
  const { value, commit } = usePickerValue<string>({
    value: valueProp,
    defaultValue,
    onValueChange,
    disabled: props.disabled,
    readOnly: props.readOnly,
    name: 'DatePicker',
  })
  const parsedValue = requireDateValue(value)
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

  const labels = { ...defaultLabels, ...props.labels }

  return (
    <Context.Provider value={{ ...props, value, commit, labels }}>
      <PickerRoot
        {...props}
        invalid={props.invalid || unavailable}
        validationMessage={unavailable ? labels.unavailable : props.validationMessage}
        placeholder={props.placeholder ?? 'Select date'}
        displayValue={
          parsedValue
            ? new Intl.DateTimeFormat(props.locale?.code ?? 'en-US', {
                year: 'numeric',
                calendar: 'gregory',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              }).format(parsedValue)
            : ''
        }
        value={value}
        serializedValue={value ?? ''}
        onClear={(details) => commit(null, details)}
        onReset={(details) => commit(defaultValue, details)}
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
  const { value, labels } = useContext()
  return (
    <PickerContent {...props} closeLabel={labels.close}>
      <Session key={value ?? ''} />
    </PickerContent>
  )
}
function Session() {
  const { value, commit, locale = enUS, minDate, maxDate, isDateUnavailable, labels } = useContext()
  const { close, canEdit } = usePickerContext()
  const [displayMonth, setDisplayMonth] = React.useState(() =>
    getInitialMonth(value ?? formatDateValue(new Date()), minDate, maxDate),
  )
  return (
    <CalendarPanel
      value={value}
      onSelect={(next, event) => {
        if (
          canEdit() &&
          commit(
            next,
            createChangeEventDetails('item-press', event.nativeEvent, event.currentTarget),
          )
        )
          close()
      }}
      displayMonth={displayMonth}
      onDisplayMonthChange={setDisplayMonth}
      locale={locale}
      minDate={minDate}
      maxDate={maxDate}
      isDateUnavailable={isDateUnavailable}
      labels={labels}
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
  DatePickerChangeEventDetails,
  DatePickerChangeEventReason,
  DatePickerClearProps,
  DatePickerContentProps,
  DatePickerLabelProps,
  DatePickerProps,
  DatePickerTriggerProps,
  DatePickerValueProps,
}
