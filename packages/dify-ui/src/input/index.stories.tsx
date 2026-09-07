import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button'
import { Field, FieldDescription, FieldError, FieldLabel } from '../field'
import { Form } from '../form'
import { Input } from './index'

const meta = {
  title: 'Base/Form/Input',
  component: Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The standalone Dify text input built on Base UI Input. Compose it with Field for labels, descriptions, and validation; use InputGroupInput for controls inside an InputGroup.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <div className="w-80">
      <label
        htmlFor="workspace-name"
        className="mb-1 block w-fit py-1 system-sm-medium text-text-secondary"
      >
        Workspace name
      </label>
      <Input
        id="workspace-name"
        name="workspaceName"
        autoComplete="organization"
        placeholder="e.g. Acme workspace…"
      />
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <div className="grid gap-1">
        <label className="system-sm-medium text-text-secondary" htmlFor="placeholder-state">
          Placeholder
        </label>
        <Input
          id="placeholder-state"
          name="placeholderState"
          placeholder="e.g. Search datasets…"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-1">
        <label className="system-sm-medium text-text-secondary" htmlFor="filled-state">
          Filled
        </label>
        <Input
          id="filled-state"
          name="filledState"
          defaultValue="Customer knowledge base"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-1">
        <Field name="repositoryUrl" invalid>
          <FieldLabel>Invalid</FieldLabel>
          <Input
            id="invalid-state"
            type="url"
            inputMode="url"
            defaultValue="github.com/langgenius"
            autoComplete="off"
            spellCheck={false}
          />
          <FieldError match>Enter a full URL including https://.</FieldError>
        </Field>
      </div>
      <div className="grid gap-1">
        <label className="system-sm-medium text-text-secondary" htmlFor="disabled-state">
          Disabled
        </label>
        <Input
          id="disabled-state"
          disabled
          name="disabledEmail"
          type="email"
          inputMode="email"
          placeholder="name@example.com…"
          autoComplete="email"
          spellCheck={false}
        />
      </div>
      <div className="grid gap-1">
        <label className="system-sm-medium text-text-secondary" htmlFor="readonly-state">
          Read-only
        </label>
        <Input
          id="readonly-state"
          readOnly
          name="endpoint"
          type="url"
          inputMode="url"
          defaultValue="https://api.example.com"
          autoComplete="url"
          spellCheck={false}
        />
      </div>
    </div>
  ),
}

export const WithField: Story = {
  render: () => (
    <Form aria-label="Account form" className="grid w-80 gap-4" onFormSubmit={() => undefined}>
      <Field name="email">
        <FieldLabel>Email</FieldLabel>
        <Input
          type="email"
          inputMode="email"
          required
          autoComplete="email"
          placeholder="name@example.com…"
          spellCheck={false}
        />
        <FieldDescription>Used for account notifications.</FieldDescription>
        <FieldError match="valueMissing">Email is required.</FieldError>
        <FieldError match="typeMismatch">Enter a valid email address.</FieldError>
      </Field>
      <Field name="repositoryUrl">
        <FieldLabel>Repository URL</FieldLabel>
        <Input
          type="url"
          inputMode="url"
          required
          autoComplete="off"
          placeholder="https://github.com/langgenius/dify…"
          spellCheck={false}
        />
        <FieldDescription>Use the full GitHub repository URL.</FieldDescription>
        <FieldError match="valueMissing">Repository URL is required.</FieldError>
        <FieldError match="typeMismatch">Enter a valid URL.</FieldError>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          Save Settings
        </Button>
      </div>
    </Form>
  ),
}
