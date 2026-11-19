import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Field, FieldLabel } from '../../field'
import { PasswordField, PasswordFieldInput, PasswordFieldToggle } from '../index'

describe('PasswordField', () => {
  it('should reveal and mask the value through a toggle with a constant name', async () => {
    const screen = await render(
      <Field name="password">
        <FieldLabel>Password</FieldLabel>
        <PasswordField>
          <PasswordFieldInput autoComplete="current-password" defaultValue="secret" />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
      </Field>,
    )
    const input = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })

    await expect.element(input).toHaveAttribute('type', 'password')
    await expect.element(input).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(input).toHaveAttribute('spellcheck', 'false')
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()

    await expect.element(input).toHaveAttribute('type', 'text')
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')

    await toggle.click()

    await expect.element(input).toHaveAttribute('type', 'password')
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('should keep focus in the input when the toggle is pressed with a pointer', async () => {
    const screen = await render(
      <PasswordField>
        <PasswordFieldInput aria-label="Password" autoComplete="current-password" />
        <PasswordFieldToggle aria-label="Show password" />
      </PasswordField>,
    )
    const input = screen.getByLabelText('Password')

    await input.click()
    await screen.getByRole('button', { name: 'Show password' }).click()

    await expect.element(input).toHaveFocus()
  })

  it('should reach the toggle after the input with the keyboard', async () => {
    const screen = await render(
      <PasswordField>
        <PasswordFieldInput aria-label="Password" autoComplete="new-password" />
        <PasswordFieldToggle aria-label="Show password" />
      </PasswordField>,
    )
    const toggle = screen.getByRole('button', { name: 'Show password' })

    await userEvent.keyboard('{Tab}')
    await expect.element(screen.getByLabelText('Password')).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect.element(toggle).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('should disable the input and the toggle from the root', async () => {
    const screen = await render(
      <PasswordField disabled>
        <PasswordFieldInput aria-label="Password" autoComplete="current-password" />
        <PasswordFieldToggle aria-label="Show password" />
      </PasswordField>,
    )

    await expect.element(screen.getByLabelText('Password')).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  })

  it('should let a read-only value be revealed', async () => {
    const screen = await render(
      <PasswordField>
        <PasswordFieldInput
          aria-label="Password"
          autoComplete="current-password"
          defaultValue="secret"
          readOnly
        />
        <PasswordFieldToggle aria-label="Show password" />
      </PasswordField>,
    )

    await screen.getByRole('button', { name: 'Show password' }).click()

    await expect.element(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
  })
})
