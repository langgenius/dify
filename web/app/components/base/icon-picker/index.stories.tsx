import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IconPickerValue } from '.'
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
  const [selection, setSelection] = useState<IconPickerValue>()

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
const [selection, setSelection] = useState<IconPickerValue>()

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
