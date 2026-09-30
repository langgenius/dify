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
import type { TimePanelHandle, TimePanelLabels, TimePanelProps } from '../time-picker/time-panel'
import type { ZonedWallTime } from './zoned-value'
import { useControlled } from '@base-ui/utils/useControlled'
import { enUS } from '@daypicker/react/locale/en-US'
import * as React from 'react'
import { Button } from '../../button'
import { CalendarPanel } from '../date-picker/calendar-panel'
import { getInitialMonth, requireDateValue } from '../date-picker/date-value'
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
import { getZonedWallTime, resolveZonedWallTime } from './zoned-value'

type DateTimePickerLabels = CalendarPanelLabels &
  TimePanelLabels & { pickTime: string; backToDate: string; now: string }
type DateTimePickerProps = PickerFieldProps &
  Pick<CalendarPanelProps, 'locale' | 'minDate' | 'maxDate' | 'isDateUnavailable'> &
  Pick<TimePanelProps, 'hourCycle'> & {
    /** An instant displayed in timeZone; null represents an empty field. */
    value?: Date | null
    defaultValue?: Date | null
    /** Called on OK, clearing or form reset; popup draft edits do not emit changes. */
    onValueChange?: (value: Date | null) => void
    timeZone: string
    isTimeUnavailable?: (wall: Readonly<ZonedWallTime>) => boolean
    labels?: Partial<DateTimePickerLabels>
  }
type ContextValue = Omit<
  DateTimePickerProps,
  'value' | 'defaultValue' | 'onValueChange' | 'children'
> & {
  value: Exclude<DateTimePickerProps['value'], undefined>
  commit: NonNullable<DateTimePickerProps['onValueChange']>
}
const Context = React.createContext<ContextValue | null>(null)
function useContext() {
  const context = React.useContext(Context)
  if (!context) throw new Error('DateTimePicker parts require DateTimePicker.')
  return context
}
const defaultLabels: DateTimePickerLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  chooseMonthAndYear: 'Choose month and year',
  month: 'Month',
  year: 'Year',
  cancel: 'Cancel',
  apply: 'OK',
  hour: 'Hour',
  minute: 'Minute',
  period: 'Period',
  am: 'AM',
  pm: 'PM',
  pickTime: 'Pick Time',
  backToDate: 'Pick Date',
  now: 'Now',
  unavailable: 'This date or time is unavailable.',
}

function DateTimePicker({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  children,
  ...props
}: DateTimePickerProps) {
  const [value, setValue] = useControlled({
    controlled: valueProp,
    default: defaultValue,
    name: 'DateTimePicker',
  })
  if (value && Number.isNaN(value.getTime())) throw new RangeError('Invalid DateTimePicker value')
  if (props.minDate) requireDateValue(props.minDate)
  if (props.maxDate) requireDateValue(props.maxDate)
  if (props.minDate && props.maxDate && props.minDate > props.maxDate)
    throw new RangeError('minDate exceeds maxDate')
  const wall = value ? getZonedWallTime(value, props.timeZone) : null
  const unavailable = Boolean(
    wall &&
    ((props.minDate && wall.date < props.minDate) ||
      (props.maxDate && wall.date > props.maxDate) ||
      props.isDateUnavailable?.(wall.date) ||
      props.isTimeUnavailable?.(wall)),
  )
  function commit(next: Date | null) {
    if (props.disabled || props.readOnly) return
    if (next?.getTime() !== value?.getTime()) {
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
        placeholder={props.placeholder ?? 'Select date and time'}
        displayValue={
          value
            ? new Intl.DateTimeFormat(props.locale?.code ?? 'en-US', {
                year: 'numeric',
                calendar: 'gregory',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: props.timeZone,
                hour12: props.hourCycle !== 24,
              }).format(value)
            : ''
        }
        serializedValue={value?.toISOString() ?? ''}
        onClear={() => commit(null)}
        onReset={() => {
          setValue(defaultValue)
          if (defaultValue?.getTime() !== value?.getTime()) onValueChange?.(defaultValue)
        }}
      >
        {children}
      </PickerRoot>
    </Context.Provider>
  )
}
type DateTimePickerTriggerProps = PickerTriggerProps
type DateTimePickerContentProps = PickerContentProps
type DateTimePickerClearProps = PickerClearProps
type DateTimePickerLabelProps = PickerLabelProps
type DateTimePickerValueProps = PickerValueProps
const DateTimePickerTrigger = PickerTrigger
const DateTimePickerClear = PickerClear
const DateTimePickerLabel = PickerLabel
const DateTimePickerValue = PickerValue
function DateTimePickerContent(props: DateTimePickerContentProps) {
  const { value, timeZone } = useContext()
  return (
    <PickerContent {...props}>
      <Session key={`${value?.getTime() ?? ''}-${timeZone}`} />
    </PickerContent>
  )
}
function Session() {
  const {
    value,
    commit,
    timeZone,
    locale = enUS,
    minDate,
    maxDate,
    isDateUnavailable,
    isTimeUnavailable,
    labels,
    hourCycle,
  } = useContext()
  const { close } = usePickerContext()
  const panelRef = React.useRef<TimePanelHandle>(null)
  const [draft, setDraft] = React.useState(() => getZonedWallTime(value ?? new Date(), timeZone))
  const [displayMonth, setDisplayMonth] = React.useState(() =>
    getInitialMonth(draft.date, minDate, maxDate),
  )
  const [view, setView] = React.useState<'date' | 'time'>('date')
  const ref = React.useRef<HTMLDivElement>(null)
  const text = { ...defaultLabels, ...labels }
  function availableInstant(candidate: typeof draft) {
    const instant = resolveZonedWallTime(candidate, timeZone, value)
    if (
      !instant ||
      (minDate && candidate.date < minDate) ||
      (maxDate && candidate.date > maxDate) ||
      isDateUnavailable?.(candidate.date) ||
      isTimeUnavailable?.(candidate)
    )
      return null
    return instant
  }
  const unavailable = !availableInstant(draft)
  const timeText = new Intl.DateTimeFormat(locale.code ?? 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: hourCycle !== 24,
    timeZone: 'UTC',
  }).format(new Date(`2025-01-01T${draft.time}:00Z`))
  const [scrollRequest, requestScroll] = React.useReducer((value: number) => value + 1, 0)
  function setNow() {
    requestScroll()
    const next = getZonedWallTime(new Date(), timeZone)
    setDraft(next)
    setDisplayMonth(getInitialMonth(next.date, minDate, maxDate))
  }
  const errorId = React.useId()
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target =
        ref.current?.querySelector<HTMLElement>(
          '[role="grid"] button[tabindex="0"], [role="option"][aria-selected="true"]',
        ) ?? ref.current?.querySelector<HTMLElement>('button:not(:disabled)')
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  }, [view])
  function changeView(next: 'date' | 'time') {
    if (view === 'time') {
      const time = panelRef.current?.settle() ?? draft.time
      setDraft((previous) => ({ ...previous, time }))
    }
    ref.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
    setView(next)
  }
  const apply = (
    <Button
      variant="primary"
      className="min-w-16"
      size="small"
      disabled={unavailable}
      aria-describedby={unavailable ? errorId : undefined}
      onClick={() => {
        const next = { ...draft, time: panelRef.current?.settle() ?? draft.time }
        setDraft(next)
        const instant = availableInstant(next)
        if (instant) {
          commit(instant)
          close()
        }
      }}
    >
      {text.apply}
    </Button>
  )
  return (
    <div ref={ref} className="flex min-h-0 flex-col overflow-hidden">
      {view === 'date' ? (
        <CalendarPanel
          value={draft.date}
          onSelect={(date) => setDraft({ ...draft, date })}
          displayMonth={displayMonth}
          onDisplayMonthChange={setDisplayMonth}
          locale={locale}
          timeZone={timeZone}
          minDate={minDate}
          maxDate={maxDate}
          isDateUnavailable={isDateUnavailable}
          labels={text}
          footer={
            <React.Fragment>
              <Button
                size="small"
                variant="secondary-accent"
                className="gap-1 px-1.5"
                aria-label={`${text.pickTime}: ${timeText}`}
                onClick={() => changeView('time')}
              >
                <span
                  className="i-ri-time-line size-3 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
                  aria-hidden="true"
                />
                {timeText}
              </Button>
              <div className="flex gap-1">
                <Button size="small" variant="ghost-accent" onClick={setNow}>
                  {text.now}
                </Button>
                {apply}
              </div>
            </React.Fragment>
          }
        />
      ) : (
        <PickerPanel
          header={<PickerPanelHeader>{text.pickTime}</PickerPanelHeader>}
          footer={
            <React.Fragment>
              <Button
                size="small"
                variant="secondary-accent"
                className="gap-1 px-1.5"
                onClick={() => changeView('date')}
              >
                <span
                  aria-hidden="true"
                  className="i-ri-calendar-line size-3 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
                />
                {text.backToDate}
              </Button>
              <div className="flex gap-1">
                <Button size="small" variant="ghost-accent" onClick={setNow}>
                  {text.now}
                </Button>
                {apply}
              </div>
            </React.Fragment>
          }
        >
          <TimePanel
            ref={panelRef}
            scrollRequest={scrollRequest}
            value={draft.time}
            onValueChange={(update) =>
              setDraft((previous) => ({ ...previous, time: update(previous.time) }))
            }
            labels={text}
            locale={locale.code}
            hourCycle={hourCycle}
          />
        </PickerPanel>
      )}
      {unavailable && (
        <p
          id={errorId}
          role="status"
          className="shrink-0 px-2 system-xs-regular text-text-destructive"
        >
          {text.unavailable}
        </p>
      )}
    </div>
  )
}

export {
  DateTimePicker,
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
  DateTimePickerValue,
}
export type {
  DateTimePickerClearProps,
  DateTimePickerContentProps,
  DateTimePickerLabelProps,
  DateTimePickerProps,
  DateTimePickerTriggerProps,
  DateTimePickerValueProps,
}
