'use client'

import type {
  PickerClearProps,
  PickerContentProps,
  PickerFieldProps,
  PickerLabelProps,
  PickerTriggerProps,
  PickerValueProps,
} from '../internal/picker-parts'
import type { TimePanelHandle, TimePanelLabels, TimePanelProps } from '../time-picker/time-panel'
import { useControlled } from '@base-ui/utils/useControlled'
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
import { TimePanel } from '../time-picker/time-panel'
import { formatTimeValue, requireTimeValue } from '../time-picker/time-value'

type TimePickerLabels = TimePanelLabels & {
  title: string
  now: string
  apply: string
  unavailable: string
}
type TimePickerProps = PickerFieldProps &
  Pick<TimePanelProps, 'hourCycle' | 'minuteStep'> & {
    /** A 24-hour HH:mm wall time, independent of a date or time zone. */
    value?: string | null
    defaultValue?: string | null
    /** Called on OK, clearing or form reset; popup draft edits do not emit changes. */
    onValueChange?: (value: string | null) => void
    isTimeUnavailable?: (value: string) => boolean
    locale?: Intl.LocalesArgument
    /** IANA zone used for Now and the initial empty draft; it does not convert value. */
    timeZone?: string
    labels?: Partial<TimePickerLabels>
  }
type ContextValue = Omit<
  TimePickerProps,
  'value' | 'defaultValue' | 'onValueChange' | 'children'
> & {
  value: Exclude<TimePickerProps['value'], undefined>
  commit: NonNullable<TimePickerProps['onValueChange']>
}
const Context = React.createContext<ContextValue | null>(null)
function useContext() {
  const context = React.useContext(Context)
  if (!context) throw new Error('TimePicker parts require TimePicker.')
  return context
}
const defaultLabels: TimePickerLabels = {
  title: 'Pick Time',
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
  const [value, setValue] = useControlled({
    controlled: valueProp,
    default: defaultValue,
    name: 'TimePicker',
  })
  requireTimeValue(value)
  const unavailable = Boolean(
    value &&
    (props.isTimeUnavailable?.(value) || Number(value.slice(3)) % (props.minuteStep ?? 1) !== 0),
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
  const { value, timeZone } = useContext()
  return (
    <PickerContent {...props}>
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
  const { close } = usePickerContext()
  const panelRef = React.useRef<TimePanelHandle>(null)
  const [draft, setDraft] = React.useState(() => value ?? currentTime(timeZone, minuteStep))
  const text = { ...defaultLabels, ...labels }
  const unavailable = Boolean(
    isTimeUnavailable?.(draft) || Number(draft.slice(3)) % minuteStep !== 0,
  )
  const [scrollRequest, requestScroll] = React.useReducer((value: number) => value + 1, 0)
  const errorId = React.useId()
  return (
    <PickerPanel
      header={<PickerPanelHeader>{text.title}</PickerPanelHeader>}
      message={
        unavailable && (
          <p id={errorId} role="status" className="px-2 system-xs-regular text-text-destructive">
            {text.unavailable}
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
            {text.now}
          </Button>
          <Button
            variant="primary"
            className="min-w-16"
            size="small"
            disabled={unavailable}
            aria-describedby={unavailable ? errorId : undefined}
            onClick={() => {
              const next = panelRef.current?.settle() ?? draft
              setDraft(next)
              if (!isTimeUnavailable?.(next) && Number(next.slice(3)) % minuteStep === 0) {
                commit(next)
                close()
              }
            }}
          >
            {text.apply}
          </Button>
        </React.Fragment>
      }
    >
      <TimePanel
        ref={panelRef}
        minuteStep={minuteStep}
        scrollRequest={scrollRequest}
        value={draft}
        onValueChange={setDraft}
        labels={text}
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
  TimePickerClearProps,
  TimePickerContentProps,
  TimePickerLabelProps,
  TimePickerProps,
  TimePickerTriggerProps,
  TimePickerValueProps,
}
