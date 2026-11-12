import {
  PasswordField,
  PasswordFieldInput,
  PasswordFieldToggle,
} from '@langgenius/dify-ui/password-field'

export function passwordFieldTypeContracts() {
  const composition = (
    <PasswordField>
      <PasswordFieldInput autoComplete="new-password" />
      <PasswordFieldToggle aria-label="Show password" />
    </PasswordField>
  )
  // @ts-expect-error The caller states whether the value is a current or a new credential.
  const withoutAutoComplete = <PasswordFieldInput />
  // @ts-expect-error The input type follows the toggle.
  const withType = <PasswordFieldInput autoComplete="new-password" type="text" />
  // @ts-expect-error The toggle is icon-only and needs an accessible name.
  const unnamedToggle = <PasswordFieldToggle />
  // @ts-expect-error The toggle owns its glyph.
  const toggleWithChildren = <PasswordFieldToggle aria-label="Show">Show</PasswordFieldToggle>

  return [composition, withoutAutoComplete, withType, unnamedToggle, toggleWithChildren]
}
