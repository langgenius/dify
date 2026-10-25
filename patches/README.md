# Dependency patches

## `@base-ui/react@1.9.0`

IconPicker is a composite field whose dialog contains independent draft controls.
The adapter uses Base UI’s neutral Field context, following `ComboboxInput`, and
resets the labelable context so draft controls do not inherit the committed field’s
ID, label, or descriptions.

The patch exposes the existing `DEFAULT_FIELD_ROOT_CONTEXT` and `LabelableContext`
through their internal entrypoints, and names the existing labelable default object
`DEFAULT_LABELABLE_CONTEXT`. It does not change the defaults or registration behavior.
ESM, CommonJS, and both declaration formats stay aligned.

These are internal exports, not upstream public APIs. On a Base UI upgrade, review
this patch against the new source and run IconPicker’s Field unit and browser tests.
Remove the patch if upstream supplies an equivalent context boundary or exports.
