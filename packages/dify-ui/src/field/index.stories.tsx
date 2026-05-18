import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button'
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from './index'

const meta = {
  title: 'Base/Form/Field',
  component: FieldRoot,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Field primitives built on Base UI Field. Use FieldRoot with FieldLabel, FieldControl, FieldDescription, and FieldError for one named form field. External form libraries can control invalid, dirty, and touched on FieldRoot.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FieldRoot>

export default meta

type Story = StoryObj<typeof meta>

export const TextField: Story = {
  render: () => (
    <form className="grid w-96 gap-4">
      <FieldRoot name="endpoint">
        <FieldLabel>Endpoint</FieldLabel>
        <FieldControl type="url" required placeholder="https://api.example.com" />
        <FieldDescription>Used as the base URL for extension requests.</FieldDescription>
        <FieldError match="valueMissing">Endpoint is required.</FieldError>
        <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
      </FieldRoot>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">Save</Button>
      </div>
    </form>
  ),
}

export const ExternalInvalidState: Story = {
  render: () => (
    <FieldRoot name="apiKey" invalid className="w-96">
      <FieldLabel>API key</FieldLabel>
      <FieldControl defaultValue="expired-key" />
      <FieldError match>API key has expired.</FieldError>
    </FieldRoot>
  ),
}
