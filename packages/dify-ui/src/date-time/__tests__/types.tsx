import type * as React from 'react'
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
  DatePickerValue,
} from '@langgenius/dify-ui/date-picker'
import {
  DateTimePicker,
  DateTimePickerContent,
  DateTimePickerTrigger,
  DateTimePickerValue,
} from '@langgenius/dify-ui/date-time-picker'
import { TimePicker, TimePickerTrigger, TimePickerValue } from '@langgenius/dify-ui/time-picker'
import { expectTypeOf } from 'vite-plus/test'

export function pickerTypeContracts(
  triggerRef: React.Ref<HTMLButtonElement>,
  contentRef: React.Ref<HTMLDivElement>,
) {
  const date = (
    <DatePicker
      label="Date"
      value="2026-09-28"
      onValueChange={(value) => {
        expectTypeOf(value).toEqualTypeOf<string | null>()
        value?.toUpperCase()
      }}
    >
      <DatePickerLabel ref={contentRef} className="mb-1">
        Date
      </DatePickerLabel>
      <DatePickerTrigger
        ref={triggerRef}
        className={(state) => (state.open ? 'text-text-accent' : '')}
      >
        <DatePickerValue>{(value) => value.toUpperCase()}</DatePickerValue>
      </DatePickerTrigger>
      <DatePickerContent ref={contentRef} style={(state) => ({ opacity: state.open ? 1 : 0 })} />
    </DatePicker>
  )
  const time = (
    <TimePicker
      label="Time"
      locale="zh-CN"
      value="22:23"
      onValueChange={(value) => {
        expectTypeOf(value).toEqualTypeOf<string | null>()
        value?.toUpperCase()
      }}
    >
      <TimePickerTrigger ref={triggerRef}>
        <TimePickerValue>{(value) => `${value} UTC+8`}</TimePickerValue>
      </TimePickerTrigger>
    </TimePicker>
  )
  const instant = (
    <DateTimePicker
      label="Meeting"
      timeZone="Asia/Shanghai"
      value={new Date()}
      onValueChange={(value) => {
        expectTypeOf(value).toEqualTypeOf<Date | null>()
        value?.toISOString()
      }}
    >
      <DateTimePickerTrigger ref={triggerRef} />
      <DateTimePickerContent ref={contentRef} />
    </DateTimePicker>
  )
  const invalidDate = (
    // @ts-expect-error Civil dates cannot accept instants.
    <DatePicker label="Date" value={new Date()}>
      {null}
    </DatePicker>
  )
  const invalidTime = (
    // @ts-expect-error Wall times cannot accept instants.
    <TimePicker label="Time" value={new Date()}>
      {null}
    </TimePicker>
  )
  const invalidInstant = (
    // @ts-expect-error Date-time values are instants, not wire strings.
    <DateTimePicker label="Meeting" timeZone="UTC" value="2026-09-28">
      {null}
    </DateTimePicker>
  )
  // @ts-expect-error The caller owns the time zone for an instant.
  const missingZone = <DateTimePicker label="Meeting">{null}</DateTimePicker>
  // @ts-expect-error Every picker requires an accessible name.
  const missingLabel = <TimePicker>{null}</TimePicker>
  const invalidCallback = (
    // @ts-expect-error Date callbacks must accept civil strings and clearing.
    <DatePicker label="Date" onValueChange={(value: Date) => value.getTime()}>
      {null}
    </DatePicker>
  )
  const partialCalendarLocale = (
    <DatePicker
      label="Date"
      locale={{ code: 'en-US', labels: { labelNav: 'Calendar navigation' } }}
    >
      {null}
    </DatePicker>
  )
  const intlLocale = (
    <TimePicker label="Time" locale={new Intl.Locale('zh-CN')}>
      {null}
    </TimePicker>
  )
  const localeFallbacks = (
    <TimePicker label="Time" locale={['en-GB', 'en-US']}>
      {null}
    </TimePicker>
  )
  const openChange = (
    <DatePicker
      label="Date"
      onOpenChange={(_open, details) => {
        details.cancel()
        // @ts-expect-error The picker owns its animation lifecycle and exposes no unmount action.
        details.preventUnmountOnClose()
      }}
    >
      {null}
    </DatePicker>
  )
  // @ts-expect-error The generated selection may be any valid date, not a caller-defined subset.
  const genericDate = <DatePicker<'2026-09-28'> label="Date">{null}</DatePicker>
  // @ts-expect-error Hover opening is not part of the picker contract.
  const hoverDelay = <DatePickerTrigger delay={100} />
  // @ts-expect-error Picker triggers always render native buttons.
  const customTrigger = <DatePickerTrigger render={<div />} />
  // @ts-expect-error The value ID belongs to the field's accessible-name relationship.
  const customValueId = <DatePickerValue id="unrelated" />
  // @ts-expect-error The label ID belongs to the field's accessible-name relationship.
  const customLabelId = <DatePickerLabel id="unrelated" />
  // @ts-expect-error Clear button dimensions belong to the picker anatomy.
  const clearSize = <DatePickerClear label="Clear date" size="sm" />
  // @ts-expect-error Content focus on entry belongs to the picker.
  const customInitialFocus = <DatePickerContent initialFocus={false} />
  const readonlyPredicate = (
    <DateTimePicker
      label="Meeting"
      timeZone="UTC"
      isTimeUnavailable={(wall) => {
        // @ts-expect-error An availability predicate must not mutate the active draft.
        wall.time = '00:00'
        return false
      }}
    >
      {null}
    </DateTimePicker>
  )
  const nonNullableChange = (
    <TimePicker
      label="Time"
      defaultValue="13:30"
      // @ts-expect-error Clearing is part of the callback contract even with an initial value.
      onValueChange={(value: string) => value.toUpperCase()}
    >
      {null}
    </TimePicker>
  )
  const invalidStep = (
    // @ts-expect-error Only steps that divide an hour are supported.
    <TimePicker label="Time" minuteStep={7}>
      {null}
    </TimePicker>
  )
  const invalidHourCycle = (
    // @ts-expect-error Hour cycle is a numeric display choice, not an Intl option string.
    <TimePicker label="Time" hourCycle="h23">
      {null}
    </TimePicker>
  )
  const instantStep = (
    // @ts-expect-error Date-time selection has minute precision and does not expose schedule steps.
    <DateTimePicker label="Meeting" timeZone="UTC" minuteStep={15}>
      {null}
    </DateTimePicker>
  )
  const formattedInstant = (
    <DateTimePicker label="Meeting" timeZone="UTC">
      <DateTimePickerTrigger>
        <DateTimePickerValue>
          {(value) => {
            expectTypeOf(value).toEqualTypeOf<string>()
            return value
          }}
        </DateTimePickerValue>
      </DateTimePickerTrigger>
    </DateTimePicker>
  )
  return {
    nonNullableChange,
    invalidStep,
    invalidHourCycle,
    instantStep,
    formattedInstant,
    partialCalendarLocale,
    intlLocale,
    localeFallbacks,
    openChange,
    genericDate,
    hoverDelay,
    customTrigger,
    customValueId,
    customLabelId,
    clearSize,
    customInitialFocus,
    readonlyPredicate,
    date,
    time,
    instant,
    invalidDate,
    invalidTime,
    invalidInstant,
    missingZone,
    missingLabel,
    invalidCallback,
  }
}
