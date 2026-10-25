import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IconPickerInputValue, IconPickerValue } from '.'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { useState } from 'react'
import { IconPicker, IconPickerContent, IconPickerIcon, IconPickerTrigger } from '.'

const meta = {
  title: 'Base/Data Entry/IconPicker',
  component: IconPicker,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Modal workflow for choosing an application avatar. Users can switch between emoji selections and image uploads (when enabled).',
      },
    },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/apps/demo-app/icon-picker',
        params: { appId: 'demo-app' },
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof IconPicker>

export default meta
type Story = StoryObj<typeof meta>

const IconPickerDemo = () => {
  const [selection, setSelection] = useState<IconPickerValue | null>(null)

  return (
    <div className="flex min-h-80 flex-col items-start gap-4 px-6 py-8 md:px-12">
      <IconPicker value={selection} onValueChange={setSelection}>
        <IconPickerTrigger aria-label="Choose icon" className="cursor-pointer rounded-[10px]">
          <IconPickerIcon size="large" />
        </IconPickerTrigger>
        <IconPickerContent />
      </IconPicker>

      <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-4 text-sm text-text-secondary shadow-sm">
        <div className="font-medium text-text-primary">Selection preview</div>
        <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-background-default-subtle p-3 font-mono text-xs/tight text-text-primary">
          {selection ? JSON.stringify(selection, null, 2) : 'No icon selected yet.'}
        </pre>
      </div>
    </div>
  )
}

export const Playground: Story = {
  args: {
    onValueChange: () => {},
    children: null,
  },
  render: () => <IconPickerDemo />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [selection, setSelection] = useState<IconPickerValue | null>(null)

return (
  <IconPicker value={selection} onValueChange={setSelection}>
    <IconPickerTrigger aria-label="Choose icon">
      <IconPickerIcon size="large" />
    </IconPickerTrigger>
    <IconPickerContent />
  </IconPicker>
)
        `.trim(),
      },
    },
  },
}

function IconPickerFormDemo() {
  const [submitted, setSubmitted] = useState<IconPickerInputValue | null>(null)
  return (
    <Form<{ icon: IconPickerInputValue }>
      className="flex min-h-80 flex-col items-start gap-4 p-8"
      onFormSubmit={({ icon }) => setSubmitted(icon)}
    >
      <Field name="icon">
        <FieldLabel nativeLabel={false} render={<span />}>
          Profile icon
        </FieldLabel>
        <IconPicker required>
          <IconPickerTrigger className="w-fit rounded-[10px]">
            <IconPickerIcon size="large" />
          </IconPickerTrigger>
          <IconPickerContent />
        </IconPicker>
        <FieldDescription>Choose an emoji or upload an image.</FieldDescription>
        <FieldError match="valueMissing">Choose an icon before saving.</FieldError>
      </Field>
      <div className="flex gap-2">
        <Button type="submit">Save</Button>
        <Button type="reset">Reset</Button>
      </div>
      <output className="font-mono text-sm whitespace-pre-wrap">
        {submitted ? JSON.stringify(submitted, null, 2) : 'No icon submitted yet.'}
      </output>
    </Form>
  )
}

export const FieldAndForm: Story = {
  args: { children: null },
  render: () => <IconPickerFormDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Field wraps the IconPicker root. The picker isolates its draft editor from the committed field’s label, validation, and form registration. The picker owns its value; Form receives the confirmed icon object. Reset restores the initial empty value.',
      },
    },
  },
}
