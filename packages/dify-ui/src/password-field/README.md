# Password Field

Use `PasswordField` for a password the user types and may reveal to check. It renders
the [Input Group] surface, so the shared border, background, focus, invalid, and disabled visuals
are the same as every other grouped input.

## Anatomy

```tsx
<Field name="password">
  <FieldLabel>Password</FieldLabel>
  <PasswordField>
    <PasswordFieldInput autoComplete="current-password" required />
    <PasswordFieldToggle aria-label="Show password" />
  </PasswordField>
</Field>
```

The anatomy mirrors the [Base UI Password Field] preview. Dify UI owns the appearance and this
public API: the surface, the input styles, the toggle's size and glyph. The reveal behavior is a
minimal local implementation until Base UI ships the primitive; the parts then become styled
wrappers around it without changing call sites.

## Contract

- `PasswordFieldInput` owns `type`. `autoComplete` is required: `current-password` for an
  existing password, `new-password` for a password being set.
- `PasswordFieldToggle` is optional. Its `aria-label` stays constant; `aria-pressed` reports
  whether the value is revealed. Pressing it with a pointer keeps focus in the input. It stays
  available while the input is read-only.
- `disabled` on `PasswordField` applies to the input and the toggle; a disabled `Field` reaches
  only the input. Wrap the field in `Field` for the label, validation, and errors.
- Other masked values, such as tokens, use `Input` with `type="password"` and `autoComplete="off"`.
  `new-password` would make browsers suggest a generated password for them.

[Base UI Password Field]: https://github.com/mui/base-ui/pull/5114
[Input Group]: ../input-group/README.md
