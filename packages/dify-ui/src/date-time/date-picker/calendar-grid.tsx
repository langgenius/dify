import type { DayPickerProps, NavProps } from '@daypicker/react'
import { TZDate } from '@date-fns/tz'
import { DayButton, DayFlag, DayPicker, SelectionState, UI } from '@daypicker/react'
import * as React from 'react'
import { useDirection } from '../../direction-provider'
import { IconButton } from '../../icon-button'
import { formatDateValue, parseDateValue } from './date-value'

type CalendarGridProps = {
  numberingSystem: string
  navigation: {
    monthLabel: string
    monthTrigger: React.ReactNode
    previousMonth: string
    nextMonth: string
  }
  value: string | null
  onSelect: (value: string) => void
  displayMonth: string
  onDisplayMonthChange: (value: string) => void
  locale?: DayPickerProps['locale']
  timeZone?: string
  focusOnMount?: boolean
  minDate?: string
  maxDate?: string
  isDateUnavailable?: (date: string) => boolean
}

function toCalendarDate(value: string): Date {
  const parsed = parseDateValue(value)
  if (!parsed) throw new RangeError(`Invalid calendar date: ${value}`)
  return parsed
}

function fromCalendarDate(date: Date): string {
  return formatDateValue(new TZDate(date.getTime(), 'UTC'))
}

function StyledDayButton(props: React.ComponentProps<typeof DayButton>) {
  return (
    <DayButton {...props} aria-current={props.modifiers.today ? 'date' : undefined}>
      {props.children}
      {props.modifiers.today && !props.modifiers.selected && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-components-button-primary-bg"
        />
      )}
    </DayButton>
  )
}

const NavigationContext = React.createContext<CalendarGridProps['navigation'] | null>(null)

function CalendarNavigation({
  previousMonth,
  nextMonth,
  onPreviousClick,
  onNextClick,
  ...navProps
}: NavProps) {
  const navigation = React.useContext(NavigationContext)!
  return (
    <nav {...navProps} className="flex h-10 items-center justify-between px-2 pt-2">
      {navigation.monthTrigger}
      <div className="flex">
        <IconButton
          size="lg"
          aria-label={navigation.previousMonth}
          disabled={!previousMonth}
          onClick={onPreviousClick}
        >
          <span
            className="i-ri-arrow-up-s-line size-4 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
            aria-hidden="true"
          />
        </IconButton>
        <IconButton
          size="lg"
          aria-label={navigation.nextMonth}
          disabled={!nextMonth}
          onClick={onNextClick}
        >
          <span
            className="i-ri-arrow-down-s-line size-4 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
            aria-hidden="true"
          />
        </IconButton>
      </div>
    </nav>
  )
}

const calendarClassNames = {
  [UI.Root]: 'w-63',
  [UI.Months]: 'w-full',
  [UI.Month]: 'w-full',
  [UI.MonthCaption]: 'sr-only',
  [UI.MonthGrid]: 'block w-full',
  [UI.Weekdays]: 'flex h-7 items-center gap-0.5 border-b-[0.5px] border-divider-regular px-2',
  [UI.Weekday]: 'flex h-7 w-8 items-center justify-center text-text-tertiary system-2xs-medium',
  [UI.Weeks]: 'flex flex-col gap-0.5 p-2',
  [UI.Week]: 'flex h-8 gap-0.5',
  [UI.Day]: 'flex size-8 items-center justify-center p-0 text-center',
  [UI.DayButton]:
    'relative flex size-8 items-center justify-center rounded-lg text-text-secondary system-sm-medium hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-state-accent-solid disabled:cursor-default',
  [SelectionState.selected]:
    '[&>button]:bg-components-button-primary-bg [&>button]:text-components-button-primary-text [&>button]:hover:bg-components-button-primary-bg forced-colors:[&>button]:outline forced-colors:[&>button]:outline-[Highlight]',
  [DayFlag.outside]:
    '[&:not([aria-selected=true])>button]:text-text-tertiary [&:not([aria-selected=true])>button]:hover:text-text-secondary',
  [DayFlag.disabled]:
    '[&>button]:cursor-not-allowed [&>button]:text-text-quaternary [&>button]:hover:bg-transparent',
} as const

function CalendarGrid({
  numberingSystem,
  navigation,
  value,
  onSelect,
  displayMonth,
  onDisplayMonthChange,
  locale,
  timeZone,
  focusOnMount,
  minDate,
  maxDate,
  isDateUnavailable,
}: CalendarGridProps) {
  const [today] = React.useState(() =>
    toCalendarDate(formatDateValue(timeZone ? new TZDate(Date.now(), timeZone) : new Date())),
  )
  const direction = useDirection()
  const selected = value ? toCalendarDate(value) : undefined
  const calendarRef = React.useRef<HTMLDivElement>(null)
  const restoreSelectionFocusRef = React.useRef(false)
  React.useLayoutEffect(() => {
    if (!restoreSelectionFocusRef.current) return
    restoreSelectionFocusRef.current = false
    // DayPicker keys day buttons by both date and display month, so outside-day selection remounts them.
    calendarRef.current?.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]')?.focus()
  }, [displayMonth])

  /* oxlint-disable jsx-a11y/no-autofocus -- DayPicker restores focus after an explicit view change, rather than autofocusing a page input. */
  return (
    <NavigationContext value={navigation}>
      <div ref={calendarRef} className="min-h-0 overflow-y-auto overscroll-none">
        <DayPicker
          mode="single"
          required
          dir={direction}
          selected={selected}
          onSelect={(date) => {
            if (!date) return
            const next = fromCalendarDate(date)
            const nextMonth = `${next.slice(0, 7)}-01`
            if (nextMonth !== displayMonth) {
              restoreSelectionFocusRef.current = true
              onDisplayMonthChange(nextMonth)
            }
            onSelect(next)
          }}
          month={toCalendarDate(displayMonth)}
          onMonthChange={(month) =>
            onDisplayMonthChange(`${fromCalendarDate(month).slice(0, 7)}-01`)
          }
          timeZone="UTC"
          today={today}
          autoFocus={focusOnMount}
          startMonth={minDate ? toCalendarDate(minDate) : toCalendarDate('0001-01-01')}
          endMonth={maxDate ? toCalendarDate(maxDate) : toCalendarDate('9999-12-31')}
          locale={locale}
          // DayPicker forwards this to Intl; its literal union lists only a subset of valid Intl identifiers.
          numerals={numberingSystem as NonNullable<DayPickerProps['numerals']>}
          showOutsideDays
          disabled={(date) => {
            const day = fromCalendarDate(date)
            return Boolean(
              (minDate && day < minDate) || (maxDate && day > maxDate) || isDateUnavailable?.(day),
            )
          }}
          components={{ DayButton: StyledDayButton, Nav: CalendarNavigation }}
          classNames={calendarClassNames}
        />
      </div>
    </NavigationContext>
  )
  /* oxlint-enable jsx-a11y/no-autofocus */
}

export { CalendarGrid, fromCalendarDate, toCalendarDate }
export type { CalendarGridProps }
