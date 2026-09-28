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

For chip-based multiple comboboxes, render `ComboboxValue` around `ComboboxChips` and label the
chips container only while it has the conditional `toolbar` role. Consumers must localize the
`ComboboxChip` Backspace/Delete description, the item-specific `ComboboxChipRemove` name, and the
input's selection count and Left Arrow hint. If `FieldDescription` already sets `aria-describedby`,
put the input hint there because it takes precedence over `aria-description`.

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

Treat collection values exposed for rendering as read-only views. In multiple mode, `SelectValue`
may receive a shared frozen empty array, and `useAutocompleteFilteredItems` exposes internal
filtered state. Use non-mutating transforms such as `map`, `filter`, or `toSorted`; create an
explicit copy only when a mutable array is required.

### Combobox source items and selected values

Combobox has separate types for the selected business value and the source record rendered by the
list:

```tsx
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { useMemo } from 'react'

const userItems = useMemo(
  () =>
    createComboboxItems(users, {
      getValue: user => user.id,
      getLabel: user => user.name,
    }),
  [users],
)

<Combobox<string, true, User>
  multiple
  items={userItems}
  value={selectedUserIds}
  onValueChange={setSelectedUserIds}
>
  <ComboboxList<User>>
    {user => <ComboboxItem<string> value={user.id}>{user.name}</ComboboxItem>}
  </ComboboxList>
</Combobox>
```

The first generic is `Value`, the second is the literal multiple-selection mode, and the third is
the source `Item`. `ComboboxValue` and `ComboboxItem` use `Value`; `filter`, `ComboboxList`,
`ComboboxGroup`, `ComboboxCollection`, and `useComboboxFilteredItems` use source items. Grouped
roots use the leaf record as `Item`, while the list callback receives the group object.

Use `createComboboxItems` when the business contract stores a stable primitive ID but list rows
need complete records. Its `getValue` result must be unique and stable, and `getLabel` owns default
filtering, typeahead, and selected-value display. Create static collections at module scope and
memoize collections derived from changing data. Treat the returned collection as opaque and pass
it directly to `items`.

For server-side search, keep the complete set of records needed to resolve selected labels in the
collection passed to `items`, and pass the current result window to `filteredItems`. Filtered items
are source `Item` records, not derived IDs, and grouped results must retain the collection's group
shape.

Keep object values when the selected record itself is the business state or the selection callback
immediately needs the full record. When async refreshes may replace object references, provide
`isItemEqualToValue` using the stable domain identity.

`itemToStringValue` only serializes a selected `Value` for forms and autofill; it does not change
`onValueChange` into an ID callback. Do not add it, `itemToStringLabel`, or a comparator as a
mechanical trio. Primitive IDs normally use the default equality. For async or paged data, keep
selected records in the collection when their labels must remain available after they leave the
current result window, or provide an ID-only label fallback.

`CheckboxGroup` follows Base UI and uses `string[]`. Model stronger business ID distinctions at
the domain boundary unless the upstream primitive contract changes.

[`Autocomplete`]: https://base-ui.com/react/components/autocomplete
[`Combobox`]: https://base-ui.com/react/components/combobox
[`RadioGroup`]: https://base-ui.com/react/components/radio
[`Select`]: https://base-ui.com/react/components/select
