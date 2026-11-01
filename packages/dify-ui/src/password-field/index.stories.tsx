import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Button } from '../button'
import { Field, FieldDescription, FieldError, FieldLabel } from '../field'
import { Form } from '../form'
import { PasswordField, PasswordFieldInput, PasswordFieldToggle } from './index'

const meta = {
  title: 'Base/Form/PasswordField',
  component: PasswordField,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A password or secret input on the InputGroup surface. PasswordFieldInput requires autoComplete; PasswordFieldToggle reveals the value and is omitted for secrets that stay masked.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PasswordField>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <Field name="password" className="w-80">
      <FieldLabel>Password</FieldLabel>
      <PasswordField>
        <PasswordFieldInput autoComplete="current-password" placeholder="Enter your password" />
        <PasswordFieldToggle aria-label="Show password" />
      </PasswordField>
    </Field>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText('Password')
    const toggle = canvas.getByRole('button', { name: 'Show password' })

    await userEvent.click(input)
    await userEvent.keyboard('secret')
    await expect(input).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle)
    await expect(input).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(input).toHaveFocus()

    await userEvent.click(toggle)
    await expect(input).toHaveAttribute('type', 'password')
  },
}

export const States: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <Field name="placeholderPassword">
        <FieldLabel>Placeholder</FieldLabel>
        <PasswordField>
          <PasswordFieldInput autoComplete="current-password" placeholder="Enter your password" />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
      </Field>
      <Field name="filledPassword">
        <FieldLabel>Filled</FieldLabel>
        <PasswordField>
          <PasswordFieldInput autoComplete="current-password" defaultValue="correct-horse" />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
      </Field>
      <Field name="invalidPassword" invalid>
        <FieldLabel>Invalid</FieldLabel>
        <PasswordField>
          <PasswordFieldInput autoComplete="new-password" defaultValue="short" />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
        <FieldError match>Use at least 8 characters with letters and numbers.</FieldError>
      </Field>
      <Field name="readonlyPassword">
        <FieldLabel>Read-only</FieldLabel>
        <PasswordField>
          <PasswordFieldInput
            autoComplete="current-password"
            readOnly
            defaultValue="correct-horse"
          />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
      </Field>
      <Field name="disabledPassword">
        <FieldLabel>Disabled</FieldLabel>
        <PasswordField disabled>
          <PasswordFieldInput autoComplete="current-password" defaultValue="correct-horse" />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
      </Field>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText('Disabled')).toBeDisabled()
    const toggles = canvas.getAllByRole('button', { name: 'Show password' })
    await expect(toggles.at(-1)).toBeDisabled()
  },
}

export const WithField: Story = {
  render: () => (
    <Form aria-label="Set password" className="grid w-80 gap-4" onFormSubmit={() => undefined}>
      <Field name="newPassword">
        <FieldLabel>New password</FieldLabel>
        <PasswordField>
          <PasswordFieldInput
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Enter a new password"
          />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
        <FieldDescription>At least 8 characters with letters and numbers.</FieldDescription>
        <FieldError match="valueMissing">Password is required.</FieldError>
        <FieldError match="tooShort">Use at least 8 characters.</FieldError>
      </Field>
      <Field name="confirmPassword">
        <FieldLabel>Confirm password</FieldLabel>
        <PasswordField>
          <PasswordFieldInput
            autoComplete="new-password"
            required
            placeholder="Enter the password again"
          />
          <PasswordFieldToggle aria-label="Show password" />
        </PasswordField>
        <FieldError match="valueMissing">Confirm your password.</FieldError>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          Set Password
        </Button>
      </div>
    </Form>
  ),
}

export const Secret: Story = {
  render: () => (
    <Field name="apiKey" className="w-80">
      <FieldLabel>API key</FieldLabel>
      <PasswordField>
        <PasswordFieldInput autoComplete="new-password" placeholder="Enter your API key" />
      </PasswordField>
      <FieldDescription>Saved keys stay masked and are never shown again.</FieldDescription>
    </Field>
  ),
}
