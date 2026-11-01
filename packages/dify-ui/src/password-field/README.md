# Password Field

Use `PasswordField` for a password or any other secret typed into a single-line input. It renders
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

- `PasswordFieldInput` owns `type`. `autoComplete` is required: `current-password` for sign-in,
  `new-password` for a new password or a secret such as an API key, so password managers do not
  treat a secret as the account password.
- `PasswordFieldToggle` is optional. Omit it when the value must stay masked, such as a stored
  secret the server returns as a placeholder. Its `aria-label` stays constant; `aria-pressed`
  reports whether the value is revealed. Pressing it with a pointer keeps focus in the input.
- `disabled` on `PasswordField` applies to the input and the toggle. Wrap the field in `Field` for
  the label, validation, and errors.

[Base UI Password Field]: https://github.com/mui/base-ui/pull/5114
[Input Group]: ../input-group/README.md
