'use client'

import type {
  PickerClearProps,
  PickerContentProps,
  PickerFieldProps,
  PickerLabelProps,
  PickerTriggerProps,
  PickerValueProps,
} from '../internal/picker-parts'
import type { TimePanelLabels, TimePanelProps } from '../internal/time-panel'
import type {
  PickerChangeEventDetails,
  PickerChangeEventReason,
} from '../internal/use-picker-value'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import { TZDate } from '@date-fns/tz'
import * as React from 'react'
import { Button } from '../../button'
import { PickerPanel, PickerPanelHeader } from '../internal/picker-panel'
import {
  PickerClear,
  PickerContent,
  PickerLabel,
  PickerRoot,
  PickerTrigger,
  PickerValue,
  usePickerContext,
} from '../internal/picker-parts'
import { TimePanel } from '../internal/time-panel'
import { formatTimeValue, requireTimeValue } from '../internal/time-value'
import { usePickerValue } from '../internal/use-picker-value'

type TimePickerLabels = TimePanelLabels & {
  title: string
  close: string
  now: string
  apply: string
  unavailable: string
}
type TimePickerChangeEventReason = PickerChangeEventReason
type TimePickerChangeEventDetails = PickerChangeEventDetails

type TimePickerProps = PickerFieldProps &
  Pick<TimePanelProps, 'hourCycle' | 'minuteStep'> & {
    /** A 24-hour HH:mm wall time, independent of a date or time zone. */
    value?: string | null
    defaultValue?: string | null
    /** Called on OK, clearing or form reset; popup draft edits do not emit changes. */
    onValueChange?: (value: string | null, details: TimePickerChangeEventDetails) => void
    isTimeUnavailable?: (value: string) => boolean
    locale?: Intl.LocalesArgument
    /** IANA zone used for Now and the initial empty draft; it does not convert value. */
    timeZone?: string
    labels?: Partial<TimePickerLabels>
  }
type ContextValue = Omit<
  TimePickerProps,
  'value' | 'defaultValue' | 'onValueChange' | 'children' | 'labels'
> & {
  labels: TimePickerLabels
  value: Exclude<TimePickerProps['value'], undefined>
  commit: (value: string | null, details: TimePickerChangeEventDetails) => boolean
}
const Context = React.createContext<ContextValue | null>(null)
function useContext() {
  const context = React.useContext(Context)
  if (!context) throw new Error('TimePicker parts require TimePicker.')
  return context
}
const defaultLabels: TimePickerLabels = {
  title: 'Pick Time',
  close: 'Close',
  hour: 'Hour',
  minute: 'Minute',
  period: 'Period',
  am: 'AM',
  pm: 'PM',
  now: 'Now',
  unavailable: 'This date or time is unavailable.',
  apply: 'OK',
}

function TimePicker({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  children,
  ...props
}: TimePickerProps) {
  const { value, commit } = usePickerValue<string>({
    value: valueProp,
    defaultValue,
    onValueChange,
    disabled: props.disabled,
    readOnly: props.readOnly,
    name: 'TimePicker',
  })
  requireTimeValue(value)
  const unavailable = Boolean(
    value &&
    (props.isTimeUnavailable?.(value) || Number(value.slice(3)) % (props.minuteStep ?? 1) !== 0),
  )

  const labels = { ...defaultLabels, ...props.labels }

  return (
    <Context.Provider value={{ ...props, value, commit, labels }}>
      <PickerRoot
        {...props}
        invalid={props.invalid || unavailable}
        validationMessage={unavailable ? labels.unavailable : props.validationMessage}
        placeholder={props.placeholder ?? 'Select time'}
        displayValue={
          value
            ? new Intl.DateTimeFormat(props.locale ?? 'en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: props.hourCycle !== 24,
                timeZone: 'UTC',
              }).format(new Date(`2025-01-01T${value}:00Z`))
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
type TimePickerTriggerProps = PickerTriggerProps
type TimePickerContentProps = PickerContentProps
type TimePickerClearProps = PickerClearProps
type TimePickerLabelProps = PickerLabelProps
type TimePickerValueProps = PickerValueProps
function TimePickerTrigger({ children, ...props }: TimePickerTriggerProps) {
  return (
    <PickerTrigger {...props}>
      {children ?? (
        <React.Fragment>
          <PickerValue />
          <span
            aria-hidden="true"
            className="i-ri-time-line size-4 shrink-0 text-text-tertiary forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
          />
        </React.Fragment>
      )}
    </PickerTrigger>
  )
}
const TimePickerClear = PickerClear
const TimePickerLabel = PickerLabel
const TimePickerValue = PickerValue
function TimePickerContent(props: TimePickerContentProps) {
  const { value, timeZone, labels } = useContext()
  return (
    <PickerContent {...props} closeLabel={labels.close}>
      <Session key={`${value ?? ''}-${timeZone ?? ''}`} />
    </PickerContent>
  )
}
function currentTime(timeZone?: string, minuteStep = 1) {
  const now = timeZone ? new TZDate(Date.now(), timeZone) : new Date()
  return formatTimeValue({
    hour: now.getHours(),
    minute: Math.floor(now.getMinutes() / minuteStep) * minuteStep,
  })
}
function Session() {
  const {
    value,
    commit,
    isTimeUnavailable,
    labels,
    locale,
    hourCycle,
    timeZone,
    minuteStep = 1,
  } = useContext()
  const { close, canEdit } = usePickerContext()
  const [draft, setDraft] = React.useState(() => value ?? currentTime(timeZone, minuteStep))
  const unavailable = Boolean(
    isTimeUnavailable?.(draft) || Number(draft.slice(3)) % minuteStep !== 0,
  )
  const [scrollRequest, requestScroll] = React.useReducer((value: number) => value + 1, 0)
  const errorId = React.useId()
  return (
    <PickerPanel
      header={<PickerPanelHeader>{labels.title}</PickerPanelHeader>}
      message={
        unavailable && (
          <p id={errorId} role="status" className="px-2 system-xs-regular text-text-destructive">
            {labels.unavailable}
          </p>
        )
      }
      footer={
        <React.Fragment>
          <Button
            size="small"
            variant="ghost-accent"
            onClick={() => {
              setDraft(currentTime(timeZone, minuteStep))
              requestScroll()
            }}
          >
            {labels.now}
          </Button>
          <Button
            variant="primary"
            className="min-w-16"
            size="small"
            disabled={unavailable}
            aria-describedby={unavailable ? errorId : undefined}
            onClick={(event) => {
              if (
                canEdit() &&
                commit(
                  draft,
                  createChangeEventDetails('item-press', event.nativeEvent, event.currentTarget),
                )
              )
                close()
            }}
          >
            {labels.apply}
          </Button>
        </React.Fragment>
      }
    >
      <TimePanel
        minuteStep={minuteStep}
        scrollRequest={scrollRequest}
        value={draft}
        onValueChange={setDraft}
        labels={labels}
        locale={locale}
        hourCycle={hourCycle}
      />
    </PickerPanel>
  )
}

export {
  TimePicker,
  TimePickerClear,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
  TimePickerValue,
}
export type {
  TimePickerChangeEventDetails,
  TimePickerChangeEventReason,
  TimePickerClearProps,
  TimePickerContentProps,
  TimePickerLabelProps,
  TimePickerProps,
  TimePickerTriggerProps,
  TimePickerValueProps,
}
