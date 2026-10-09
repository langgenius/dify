import type { DayPickerProps } from '@daypicker/react'
import * as React from 'react'
import { Button } from '../../button'
import { OptionColumn } from '../internal/option-column'
import { PickerColumns, PickerPanel, PickerPanelHeader } from '../internal/picker-panel'
import { usePickerNumbers } from '../internal/use-picker-numbers'
import { CalendarGrid, toCalendarDate } from './calendar-grid'

type CalendarPanelLabels = {
  previousMonth: string
  nextMonth: string
  chooseMonthAndYear: string
  month: string
  year: string
  cancel: string
  apply: string
  unavailable: string
}

type CalendarPanelProps = {
  value: string | null
  onSelect: (date: string) => void
  displayMonth: string
  onDisplayMonthChange: (month: string) => void
  locale?: DayPickerProps['locale']
  timeZone?: string
  minDate?: string
  maxDate?: string
  isDateUnavailable?: (date: string) => boolean
  labels: CalendarPanelLabels
  footer?: React.ReactNode
}

function CalendarPanel({
  value,
  onSelect,
  displayMonth,
  onDisplayMonthChange,
  locale,
  timeZone,
  minDate,
  maxDate,
  isDateUnavailable,
  labels,
  footer,
}: CalendarPanelProps) {
  const [monthPickerHeight, setMonthPickerHeight] = React.useState<number | null>(null)
  const choosingMonth = monthPickerHeight !== null
  const monthPickerId = React.useId()
  const errorId = React.useId()
  const [draftMonth, setDraftMonth] = React.useState(displayMonth)
  const [focusCalendar, setFocusCalendar] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const headerRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (choosingMonth || !focusCalendar) return
    const frame = requestAnimationFrame(() => {
      if (!panelRef.current?.querySelector('[role="grid"] button[tabindex="0"]'))
        headerRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [choosingMonth, focusCalendar])
  const year = Number(draftMonth.slice(0, 4))
  const month = Number(draftMonth.slice(5, 7))
  const minYear = minDate
    ? Number(minDate.slice(0, 4))
    : Math.min(1900, Number(displayMonth.slice(0, 4)))
  const maxYear = maxDate
    ? Number(maxDate.slice(0, 4))
    : Math.max(2100, Number(displayMonth.slice(0, 4)))
  const numbers = usePickerNumbers(locale?.code)
  const monthFormatting = React.useMemo(() => {
    const options = { month: 'long', calendar: 'gregory', timeZone: 'UTC' } as const
    const formatter = new Intl.DateTimeFormat(locale?.code ?? 'en-US', options)
    return {
      caption: new Intl.DateTimeFormat(locale?.code ?? 'en-US', { ...options, year: 'numeric' }),
      options: Array.from({ length: 12 }, (_, index) => ({
        value: index + 1,
        label: formatter.format(new Date(Date.UTC(2025, index, 1))),
      })),
    }
  }, [locale?.code])
  const monthLabel = monthFormatting.caption.format(toCalendarDate(displayMonth))
  function outOfBounds(candidate: string) {
    return Boolean(
      (minDate && candidate.slice(0, 7) < minDate.slice(0, 7)) ||
      (maxDate && candidate.slice(0, 7) > maxDate.slice(0, 7)),
    )
  }
  function handleEscape(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
  }
  const unavailable = outOfBounds(draftMonth)
  function focusPopup() {
    panelRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
  }
  function finish(apply: boolean) {
    if (apply && outOfBounds(draftMonth)) return
    focusPopup()
    setFocusCalendar(apply)
    if (apply) onDisplayMonthChange(draftMonth)
    setMonthPickerHeight(null)
    if (!apply) requestAnimationFrame(() => headerRef.current?.focus())
  }
  const monthTrigger = (
    <Button
      ref={headerRef}
      variant="ghost"
      type="button"
      aria-label={`${labels.chooseMonthAndYear}: ${monthLabel}`}
      aria-expanded={choosingMonth}
      aria-controls={choosingMonth ? monthPickerId : undefined}
      className="gap-0.5 px-2 text-sm leading-5 font-semibold text-text-primary"
      onKeyDown={choosingMonth ? handleEscape : undefined}
      onClick={() => {
        if (choosingMonth) {
          finish(false)
          return
        }
        const height = panelRef.current?.offsetHeight
        if (height === undefined) return
        focusPopup()
        setDraftMonth(displayMonth)
        setMonthPickerHeight(height)
      }}
    >
      {monthLabel}
      <span
        aria-hidden="true"
        className={`${choosingMonth ? 'i-ri-arrow-up-s-line' : 'i-ri-arrow-down-s-line'} size-4 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none`}
      />
    </Button>
  )
  return (
    <PickerPanel
      ref={panelRef}
      style={monthPickerHeight === null ? undefined : { height: monthPickerHeight }}
      header={
        choosingMonth && (
          <PickerPanelHeader className="items-start px-2 pt-2">{monthTrigger}</PickerPanelHeader>
        )
      }
      message={
        choosingMonth &&
        unavailable && (
          <p id={errorId} role="status" className="px-2 system-xs-regular text-text-destructive">
            {labels.unavailable}
          </p>
        )
      }
      footer={
        choosingMonth ? (
          <React.Fragment>
            <Button
              size="small"
              variant="secondary"
              className="flex-1"
              onKeyDown={handleEscape}
              onClick={() => finish(false)}
            >
              {labels.cancel}
            </Button>
            <Button
              size="small"
              variant="primary"
              className="flex-1"
              disabled={unavailable}
              aria-describedby={unavailable ? errorId : undefined}
              onKeyDown={handleEscape}
              onClick={() => finish(true)}
            >
              {labels.apply}
            </Button>
          </React.Fragment>
        ) : (
          footer
        )
      }
    >
      {choosingMonth ? (
        <PickerColumns
          id={monthPickerId}
          role="group"
          aria-label={labels.chooseMonthAndYear}
          aria-describedby={unavailable ? errorId : undefined}
        >
          <OptionColumn
            onEscape={() => finish(false)}
            focusOnMount
            normalizeDigits={numbers.normalizeDigits}
            label={labels.month}
            value={month}
            options={monthFormatting.options}
            onValueChange={(next) =>
              setDraftMonth(
                (previous) => `${previous.slice(0, 4)}-${String(next).padStart(2, '0')}-01`,
              )
            }
          />
          <OptionColumn
            onEscape={() => finish(false)}
            normalizeDigits={numbers.normalizeDigits}
            label={labels.year}
            value={year}
            options={Array.from({ length: maxYear - minYear + 1 }, (_, index) => ({
              value: minYear + index,
              label: numbers.formatInteger(minYear + index),
            }))}
            onValueChange={(next) =>
              setDraftMonth(
                (previous) => `${String(next).padStart(4, '0')}-${previous.slice(5, 7)}-01`,
              )
            }
          />
        </PickerColumns>
      ) : (
        <CalendarGrid
          numberingSystem={numbers.numberingSystem}
          navigation={{
            monthLabel,
            monthTrigger,
            previousMonth: labels.previousMonth,
            nextMonth: labels.nextMonth,
          }}
          focusOnMount={focusCalendar}
          value={value}
          onSelect={onSelect}
          displayMonth={displayMonth}
          onDisplayMonthChange={onDisplayMonthChange}
          locale={locale}
          timeZone={timeZone}
          minDate={minDate}
          maxDate={maxDate}
          isDateUnavailable={isDateUnavailable}
        />
      )}
    </PickerPanel>
  )
}
export { CalendarPanel }
export type { CalendarPanelLabels, CalendarPanelProps }
