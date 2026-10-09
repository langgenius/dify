# Web date and time pickers

Use the local `date-picker`, `time-picker`, or `date-time-picker` entry in Web. Each exports
the localized Root plus the matching Dify UI Label, Trigger, Value, Clear, Content and prop types.

These roots own application language, calendar-locale mapping, direction, translated actions,
validation messages and default placeholders. They preserve the library props and caller overrides.
They do not own values, time zones, popup state, selection logic or business serialization.
Parts and types are re-exported unchanged; only Root integrates application defaults. Import the
whole composition from its matching Web entry, without a shared barrel for all three pickers.
Do not pass a repeated locale bundle at each call site.

```tsx
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@/app/components/base/date-time-picker/date-picker'

;<DatePicker value={date} onValueChange={setDate}>
  <DatePickerLabel>{fieldTitle}</DatePickerLabel>
  <DatePickerTrigger />
  <DatePickerContent />
</DatePicker>
```

Use the picker Label for clickable visible text. Do not point a native label or FieldLabel at
the trigger: that can activate its button and open the popup. Existing external text can supply
`aria-labelledby` on Trigger and Content; its owner is responsible for focus forwarding.
Without a Label, provide an accessible name on each part; Root has no naming props. Keep help actions beside Label.
Clear uses `aria-label` or `aria-labelledby` and may share a visual container with Trigger; do not nest
it inside the trigger button. Values and submission behavior follow the [Dify UI picker contract].

## Business owners

| Owner                              | Responsibility                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Monitoring date range]            | Two dates with the shared 30-day/past-date restriction and compact presentation; overview and Agent monitoring retain their query state and payload formatting. |
| [Tool date parameters]             | Tool field names, unknown-value validation, empty-string clearing and range serialization. Workflow and plugin configuration use the same components.           |
| Dataset metadata date field        | Profile time zone, Unix seconds, metadata display format and read-only state.                                                                                   |
| Knowledge-retrieval date condition | Profile time zone, Unix seconds, optional-value clearing and disabled state.                                                                                    |
| Auto-update settings               | Quarter-hour choices, update configuration conversion and the time-zone settings action.                                                                        |
| Schedule trigger                   | Schedule clock-string conversion, configured time zone and workflow read-only state.                                                                            |
| Markdown form                      | Declared input types and labels, source-value parsing and form submission.                                                                                      |

Add a business wrapper only for one of these stable domain contracts. Compose the localized root
directly for one-off forms; do not introduce another general picker API with display-mode flags.

Tool date ranges read the parameter contract's object or JSON object string and emit a JSON string
with optional `start`/`end` civil dates; clearing both emits `''`. A bare date is not a date range.
There are no legacy picker imports, forwarding entrypoints or old-prop adapters.

`date-value.ts` validates civil strings at Web input boundaries. Day.js remains in monitoring and
existing business storage/display calculations; it is not passed into Dify UI, whose values are
civil strings, wall-time strings or Date instants. Do not add a second conversion inside the roots.

[Dify UI picker contract]: ../../../../../packages/dify-ui/src/date-time/README.md
[Monitoring date range]: ../../app/monitoring/date-range-picker.tsx
[Tool date parameters]: ../../tools/parameters/tool-date-picker.tsx
