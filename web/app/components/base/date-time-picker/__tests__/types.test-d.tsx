import type { DatePickerChangeEventDetails, DatePickerChangeEventReason } from '../date-picker'
import type {
  DateTimePickerChangeEventDetails,
  DateTimePickerChangeEventReason,
} from '../date-time-picker'
import type { TimePickerChangeEventDetails, TimePickerChangeEventReason } from '../time-picker'
import { expectTypeOf } from 'vite-plus/test'
import { DatePicker } from '../date-picker'
import { DateTimePicker } from '../date-time-picker'
import { TimePicker } from '../time-picker'

export function localizedPickerEventContracts() {
  return (
    <>
      <DatePicker
        onValueChange={(value, details) => {
          expectTypeOf(value).toEqualTypeOf<string | null>()
          expectTypeOf(details).toEqualTypeOf<DatePickerChangeEventDetails>()
          expectTypeOf(details.reason).toEqualTypeOf<DatePickerChangeEventReason>()
          if (details.reason === 'reset') expectTypeOf(details.event).toEqualTypeOf<Event>()
          details.cancel()
        }}
      >
        {null}
      </DatePicker>
      <TimePicker
        onValueChange={(value, details) => {
          expectTypeOf(value).toEqualTypeOf<string | null>()
          expectTypeOf(details).toEqualTypeOf<TimePickerChangeEventDetails>()
          expectTypeOf(details.reason).toEqualTypeOf<TimePickerChangeEventReason>()
          details.cancel()
        }}
      >
        {null}
      </TimePicker>
      <DateTimePicker
        timeZone="UTC"
        onValueChange={(value, details) => {
          expectTypeOf(value).toEqualTypeOf<Date | null>()
          expectTypeOf(details).toEqualTypeOf<DateTimePickerChangeEventDetails>()
          expectTypeOf(details.reason).toEqualTypeOf<DateTimePickerChangeEventReason>()
          details.cancel()
        }}
      >
        {null}
      </DateTimePicker>
    </>
  )
}
