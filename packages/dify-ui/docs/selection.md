# Selection

Choose a selection primitive from the value and interaction contract, then preserve the caller's
domain value type through its public API.

## Primitive choice

- [`RadioGroup`] selects one persistent field value from a visible set of options. Every `Radio` or
  `RadioItem` belongs to a group; do not render a standalone radio.
- `SegmentedControl` selects one mode, filter, or view. It follows radio-group semantics: an active
  item cannot be toggled off, `Tab` enters on the selected item, and arrow keys move and select.
- `Tabs` selects a panel and provides `tablist` and `tabpanel` semantics.
- [`Autocomplete`] accepts free-form text with optional suggestions.
- [`Combobox`] selects and remembers one or more values from a searchable collection.
- [`Select`] chooses from a closed, scannable list without text entry.

Multiple-selection comboboxes follow the Base UI chips composition: chips and the input share the
input group, chips wrap, and the group grows vertically.

Autocomplete, Combobox, and Select popups use Base UI's `--anchor-width` and `--available-width`
variables to follow their trigger while clamping to the viewport. Do not replace that sizing with
a fixed width or an unclamped minimum width.

Use `Radio` for the default radio appearance. Use `RadioItem` when custom content itself is a
radio item, and put `RadioControl` inside it for Dify UI's visual indicator. `RadioControl` is a
visual part, not a standalone radio.

Import the complete family from its single public subpath:

```tsx
import { Radio, RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
```

## Typed values

Do not widen domain values to `string`. Use `Select<Value, Multiple>`, `RadioGroup<Value>`,
`Radio<Value>`, and `RadioItem<Value>` for enums, unions, booleans, numbers, objects, or nullable
placeholder values.

Root generics type `value`, `defaultValue`, and value-dependent callbacks. JSX children do not
inherit the parent's generic, so type independently consumed anatomy when its value cannot be
inferred locally:

```tsx
<RadioGroup<PromptMode> value={promptMode} onValueChange={setPromptMode}>
  <Radio<PromptMode> value={PROMPT_MODE.default} />
  <RadioItem<PromptMode> value={PROMPT_MODE.custom}>
    <RadioControl />
    Custom prompt
  </RadioItem>
</RadioGroup>
```

For `Select` and `Combobox`, the literal multiple-value type must match runtime mode:
`<Combobox<Subject, true> multiple>`. Value display can still receive `null` before selection.
Repeat the domain type on independently consumed render anatomy rather than annotating callback
parameters:

```tsx
<Combobox<Subject, true> multiple value={subjects} onValueChange={setSubjects}>
  <ComboboxValue<Subject, true>>
    {(selected) => selected?.map((subject) => subject.name).join(', ') ?? 'Anyone'}
  </ComboboxValue>
  <ComboboxList<Subject>>
    {(subject) => <ComboboxItem value={subject}>{subject.name}</ComboboxItem>}
  </ComboboxList>
</Combobox>
```

`AutocompleteList` follows the same rule. Groups may infer their local type from `items`; a nested
`Collection` is a separate JSX boundary. Dynamic `multiple={condition}` produces the corresponding
single-or-multiple union.

Prefer the Base UI `items` collection pattern so the root, value display, and item list share one
runtime source of truth. Convert values to strings only at real serialization boundaries.

`CheckboxGroup` follows Base UI and uses `string[]`. Model stronger business ID distinctions at
the domain boundary unless the upstream primitive contract changes.

[`Autocomplete`]: https://base-ui.com/react/components/autocomplete
[`Combobox`]: https://base-ui.com/react/components/combobox
[`RadioGroup`]: https://base-ui.com/react/components/radio
[`Select`]: https://base-ui.com/react/components/select
