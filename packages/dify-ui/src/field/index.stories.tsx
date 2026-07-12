import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from './index'

const meta = {
  title: 'Base/Form/Field',
  component: Field,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Field primitives built on Base UI Field. Use Field with FieldLabel, FieldControl, FieldDescription, and FieldError for one named form field. External form libraries can control invalid, dirty, and touched on Field.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Field>

export default meta

type Story = StoryObj<typeof meta>

export const TextField: Story = {
  render: () => (
    <form className="grid w-96 gap-4">
      <Field name="endpoint">
        <FieldLabel>Endpoint</FieldLabel>
        <FieldControl type="url" required placeholder="https://api.example.com" />
        <FieldDescription>Used as the base URL for extension requests.</FieldDescription>
        <FieldError match="valueMissing">Endpoint is required.</FieldError>
        <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">Save</Button>
      </div>
    </form>
  ),
}

export const MultipleFields: Story = {
  render: () => (
    <form className="grid w-96 gap-4">
      <Field name="name">
        <FieldLabel>Name</FieldLabel>
        <FieldControl required placeholder="Production API" />
        <FieldError match="valueMissing">Name is required.</FieldError>
      </Field>
      <Field name="endpoint">
        <FieldLabel>Endpoint</FieldLabel>
        <FieldControl type="url" required placeholder="https://api.example.com" />
        <FieldDescription>Used as the base URL for extension requests.</FieldDescription>
        <FieldError match="valueMissing">Endpoint is required.</FieldError>
        <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
      </Field>
      <Field name="apiKey">
        <FieldLabel>API key</FieldLabel>
        <FieldControl required placeholder="sk-..." />
        <FieldDescription>Stored with the extension configuration.</FieldDescription>
        <FieldError match="valueMissing">API key is required.</FieldError>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">Save</Button>
      </div>
    </form>
  ),
}

export const ExternalInvalidState: Story = {
  render: () => (
    <Field name="apiKey" invalid className="w-96">
      <FieldLabel>API key</FieldLabel>
      <FieldControl defaultValue="expired-key" />
      <FieldError match>API key has expired.</FieldError>
    </Field>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <Field name="smallEndpoint">
        <FieldLabel>Small</FieldLabel>
        <FieldControl size="small" placeholder="Small input" />
      </Field>
      <Field name="regularEndpoint">
        <FieldLabel>Regular</FieldLabel>
        <FieldControl placeholder="Regular input" />
      </Field>
      <Field name="largeEndpoint">
        <FieldLabel>Large</FieldLabel>
        <FieldControl size="large" placeholder="Large input" />
      </Field>
    </div>
  ),
}

export const ReadOnly: Story = {
  render: () => (
    <Field name="readonlyEndpoint" className="w-96">
      <FieldLabel>Endpoint</FieldLabel>
      <FieldControl readOnly defaultValue="https://api.example.com" />
      <FieldDescription>This value is managed by the workspace owner.</FieldDescription>
    </Field>
  ),
}
