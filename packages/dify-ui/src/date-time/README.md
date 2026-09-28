# Date and time pickers

These three families share field anatomy, a non-modal popover and keyboard navigation. Choose
from the value's meaning; they do not accept free-form text or arbitrary collection values.

| Public subpath                         | Value / `onValueChange`                  | Native form value   | Selection commits |
| -------------------------------------- | ---------------------------------------- | ------------------- | ----------------- |
| `@langgenius/dify-ui/date-picker`      | `string \| null`, Gregorian `YYYY-MM-DD` | `YYYY-MM-DD`        | Selecting a day   |
| `@langgenius/dify-ui/time-picker`      | `string \| null`, 24-hour `HH:mm`        | `HH:mm`             | OK                |
| `@langgenius/dify-ui/date-time-picker` | `Date \| null`, an instant               | ISO 8601 UTC string | OK                |

`DateTimePicker` requires an IANA `timeZone` for display and editing. `TimePicker.timeZone` only
controls Now and the initial empty draft; it never converts a stored wall time. Date-only values
have no time zone. Parse API payloads and perform business conversions outside this package.
These fixed value models do not need generics. The public prop types own the complete API.

## Anatomy and labels

Each subpath exports its root, Label, Trigger, Value, Clear, Content and corresponding prop types.
Use one family consistently:

```tsx
import {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@langgenius/dify-ui/date-picker'

;<form>
  <DatePicker name="start" defaultValue="2025-01-15">
    <DatePickerLabel>Start date</DatePickerLabel>
    <div className="flex items-center gap-1">
      <DatePickerTrigger />
      <DatePickerClear aria-label="Clear start date" />
    </div>
    <DatePickerContent />
  </DatePicker>
</form>
```

Provide an accessible name at the call site. Root has no labeling props and does not enforce
Label composition through its types. Prefer one visible Label with its text as children; it names
both Trigger and Content through `aria-labelledby`. Clicking plain label text focuses the actual
trigger without opening it. Links and controls inside a custom label keep their own behavior.
Do not use native `label[for]` or `FieldLabel` for the trigger: native activation can click its button.

For compact layouts, a Label with `className="sr-only"` shares one name without visible text.
Without a Label, name Trigger and Content explicitly using standard ARIA attributes:

```tsx
<DatePicker>
  <DatePickerTrigger aria-label="Start date" aria-describedby="start-help" />
  <DatePickerContent aria-label="Choose start date" />
</DatePicker>
```

External text can name both parts through `aria-labelledby`; click forwarding remains with its
owner. Explicit names override the automatic Label association. When a Trigger references label
text, its committed Value is appended to the name. An explicit `aria-label` supplies the whole name.
Trigger's `aria-describedby` is combined with required and validation feedback. Do not rely on
placeholder or selected text alone to identify the field.

Trigger is a native button. Its default children contain Value and a decorative icon. If replacing
those children, include exactly one Value; its render callback receives the formatted committed
text (or the placeholder), not the raw value. Put meaningful annotations such as a time-zone suffix
inside Value so they participate in the accessible name. Keep decorative icons `aria-hidden`.
Clear inherits IconButton's `aria-label` / `aria-labelledby` naming contract. Trigger and Clear may
share a visual field container; their placement is caller-owned. Do not nest Clear inside the
native Trigger button.

Content owns the portal, initial focus, calendar, columns and actions. Its props derive from the
Dify Popover content contract, excluding replacement children, `render` and `initialFocus`.
Use `className`/`style` for deliberate presentation overrides. Normal content keeps its natural
height, including the calendar's week count, and flips above or below its trigger. It does not
shrink itself on mobile. An explicit `maxHeight` opts into scrolling the body/columns while keeping
actions visible. A viewport too short for natural content needs a consumer layout decision.

## State and interaction

Use `defaultValue` for uncontrolled fields or `value` with `onValueChange` for controlled fields.
`null` means empty; clearing emits `null`. Do not switch controlledness during a field's lifetime.
`open`/`defaultOpen` follow the same ownership choice. `onOpenChange` details support `cancel()`.

Time and date-time edits, including Now, stay in the open session until OK. Switching date/time
views preserves the draft. Dismissal discards it; reopening starts from the committed value.
Changing the controlled value or time zone starts a fresh draft. Unchanged confirmation does not
emit a duplicate value change. In DatePicker, a day selection commits immediately. The month/year
selector only changes the displayed month when confirmed; it does not select a date.

The calendar uses DayPicker's grid navigation. Adjacent-month dates remain selectable and, while
the popup remains open, switch the view to their month. `minDate`, `maxDate` and
`isDateUnavailable` restrict dates. Time availability is evaluated on the complete combination:
intermediate unavailable drafts remain navigable, but OK is disabled with an announced message.

Time and month/year columns use single-select listboxes with `aria-selected` and roving DOM focus.
Selection follows focus within the draft, not the committed field value:

- Up/Down move one option; Page Up/Down move five; Home/End reach the endpoints. Navigation clamps
  at the ends; no `loopFocus` API is exposed.
- Numeric locating accepts ASCII and localized digits. Month names also support typeahead.
- Tab moves between columns and actions, not every option. Escape leaves month/year selection
  first; Escape from the main picker dismisses and restores trigger focus. Tab can leave the popup.
- Hover does not select. Keyboard changes scroll immediately; pointer selection may scroll
  smoothly, respecting reduced motion. Wheel/touch scrolling updates the draft and aligns the
  nearest option at the top when it settles.

`hourCycle` selects 12-hour (default) or 24-hour display; stored wall time remains 24-hour.
TimePicker alone supports `minuteStep` (1, 5, 10, 15, 20 or 30; default 1). Now rounds down to that
step. DateTimePicker edits whole minutes, rejects nonexistent daylight-saving times, preserves an
unchanged instant (including a repeated time), and resolves an edited ambiguous time to the earlier
instant. Business rules can further restrict it through `isTimeUnavailable`.

## Localization and native forms

DatePicker and DateTimePicker accept DayPicker locale objects; TimePicker accepts Intl locale
identifiers. Locale controls formatting and digits, not the calendar system or serialized values.
Action labels and validation copy have English defaults; consumers translate `labels`, field and
clear labels, placeholders, `requiredLabel` and `validationMessage`. Direction inherits
`DirectionProvider` or a local `direction` override and reaches the portaled popup independently of
locale. Set HTML `dir` for the surrounding layout too.

With `name`, the committed value participates in native FormData; an empty field submits `''`.
`form` can associate an external form. Required/invalid fields block native validated submission
and focus the first invalid trigger. Reset restores `defaultValue` and closes the popup; a
controlled owner must accept the reset callback. Disabled fields are omitted from submission;
read-only fields remain focusable and submit their value without allowing edits. These pickers do
not register with Base UI Field/Form. See [Forms] for the surrounding form boundary.

## Examples and verification

The colocated stories own documented configurations and primary interaction flows. Docs leave
popups closed; explicit open previews exercise calendar, month/year and time content with the
configured axe checks. Use the Storybook theme toolbar for light/dark inspection.

Browser unit tests own regressions: label composition, controlled sessions, date constraints,
scroll interruption, sizing, localized input and daylight-saving conversion. The shared
`__tests__/types.tsx` fixture checks public imports, inferred values, nullable callbacks and rejected
configurations during type checking; it is not a runtime test. See [Testing] for commands and
ownership. Automated axe and Chromium tests do not replace physical touch and screen-reader checks.

[Forms]: ../../docs/forms.md
[Testing]: ../../docs/testing.md
