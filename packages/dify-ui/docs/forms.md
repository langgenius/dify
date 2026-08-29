# Forms

Dify UI form primitives compose Base UI's native form semantics, field accessibility, and Dify
styling. They are not a form state-management or schema framework. See the [Base UI forms
handbook] for the upstream model.

## Submit boundary

Every group of controls that saves or submits together needs a real `<form>` boundary. Do not wire
an `Input` and a click-only `Button` together as an informal form.

Use `Form` when the Dify UI boundary should own Base UI's structured `onFormSubmit` values,
consolidated errors, `actionsRef`, or `validationMode`. It renders a native `<form>`. A native form
remains correct when another form library owns submission and validation; do not nest form owners.

Set [`Button`] submit buttons to `type="submit"` explicitly. Keep every other button inside a form
at `type="button"`.

## Fields and labels

Use `Field` when a control needs a shared name, label, validation, description, or error state. A
standalone `Input` may use a native `<label htmlFor>` relationship, but normal form rows should
prefer a visible label. `FieldDescription` and `FieldError` provide the corresponding accessible
message relationships.

Choose the label primitive by the control:

- Text-like inputs, `Textarea`, input-based `Combobox` and `Autocomplete`, a single `Checkbox`,
  each `Radio` option, `Switch`, and `NumberField` use `FieldLabel`.
- Trigger-based `Select` fields use `SelectLabel`.
- `Slider` fields follow the [Base UI Slider anatomy] and use `SliderLabel`; only multi-thumb
  sliders add per-thumb `aria-label` to distinguish the thumbs.
- `SelectGroupLabel` and `AutocompleteGroupLabel` label option groups inside popup content. They
  are not field labels.

Use [`InputGroup`] when a prefix, suffix, or action shares the input's visual surface.

## Grouped controls

Use `Fieldset` and `FieldsetLegend` when one field contains related controls, such as checkbox or
radio groups, multi-thumb sliders, or a section of related inputs. Wrap each checkbox or radio
option with `FieldItem` and give it its own label:

```tsx
<Field name="allowedNetworkProtocols">
  <Fieldset render={<CheckboxGroup />}>
    <FieldsetLegend>Allowed network protocols</FieldsetLegend>
    <FieldItem>
      <FieldLabel className="flex items-center gap-2">
        <Checkbox value="https" />
        HTTPS
      </FieldLabel>
    </FieldItem>
  </Fieldset>
</Field>
```

`Fieldset` owns group semantics and the legend relationship, not interactive state. Pass
`disabled`, `value`, `defaultValue`, and change handlers to the group primitive.

Every radio belongs to a `RadioGroup`. Use `FieldsetLegend` to name the group and `FieldLabel` to
name each option; do not render a standalone `Radio`.

Keep form state, schemas, server validation, and reset behavior outside these primitives. Pass
their observable state through the public field and control props instead of replacing the
semantic structure.

[Base UI Slider anatomy]: https://base-ui.com/react/components/slider#anatomy
[Base UI forms handbook]: https://base-ui.com/react/handbook/forms
[`Button`]: ../src/button/README.md
[`InputGroup`]: ../src/input-group/README.md
